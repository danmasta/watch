import { defaults, noop } from 'lo';
import { exec, fork, spawn } from 'node:child_process';
import EventEmitter from 'node:events';
import process from 'node:process';
import { WatchError } from './util.js';
import { watcher } from './watcher.js';

const defs = {
    type: 'fork',
    cmd: 'index',
    args: undefined,
    src: '**',
    ignore: '(.git|node_modules)/**',
    exts: undefined,
    cwd: process.cwd(),
    uid: undefined,
    gid: undefined,
    env: process.env,
    shell: undefined,
    signal: 'SIGTERM',
    stdin: undefined,
    stdout: process.stdout,
    stderr: process.stderr,
    execPath: undefined,
    execArgs: undefined,
    debounce: undefined,
    watch: true,
    start: true,
    restart: true
};

export class Watchmon extends EventEmitter {

    constructor (opts) {

        super();

        let { start } = this.opts = opts = defaults(opts, defs);

        this.running = false;
        this.proc = null;
        this.promise = null;

        // Note: Prevent uncaught exception from error events
        this.on('error', noop);

        process.once('SIGINT', () => {
            this.kill({ signal: 'SIGINT', exit: true });
        });
        process.once('SIGTERM', () => {
            this.kill({ signal: 'SIGTERM', exit: true });
        });

        if (start) {
            this.start();
        }

    }

    spawn () {
        if (!this.running) {

            let { type, cmd, args, cwd, env, execPath, execArgs, uid, gid, shell, signal, stdin, stdout, stderr } = this.opts;
            let proc, ERR, output;

            switch (type) {
                case 'fork':
                    proc = fork(cmd, args, {
                        cwd,
                        env,
                        execPath,
                        execArgs,
                        uid,
                        gid,
                        killSignal: signal,
                        stdio: 'pipe'
                    });
                    break;
                case 'spawn':
                    proc = spawn(cmd, args, {
                        cwd,
                        env,
                        uid,
                        gid,
                        shell,
                        killSignal: signal,
                        stdio: 'pipe'
                    });
                    break;
                case 'exec':
                    try {
                        // Note: Exec doesn't support streaming
                        proc = exec(cmd, {
                            cwd,
                            env,
                            uid,
                            gid,
                            shell,
                            killSignal: signal,
                            stdio: 'pipe'
                        }, (err, stdout, stderr) => {
                            if (err) {
                                ERR = err;
                            }
                            output = { stdout, stderr };
                        });
                    } catch (err) {
                        this.emit('error', new WatchError('Failed to exec: %d\n%s', err.errno, err.stack), err.errno, err.code);
                        return;
                    }
                    break;
                default:
                    throw new WatchError('Exec type not supported: %s', type);
            }

            if (type !== 'exec') {
                if (stdin) {
                    stdin.pipe(proc.stdin, { end: true });
                }
                if (stdout) {
                    proc.stdout.pipe(stdout, { end: false });
                }
                if (stderr) {
                    proc.stderr.pipe(stderr, { end: false });
                }
            }

            proc.once('spawn', () => {
                this.emit('spawn', proc);
            });

            // Note: Exiting, stdio still open
            proc.once('exit', (code, signal) => {
                // Note: Catch spawn errors from fork
                if (type === 'fork') {
                    if (code !== 0 && proc.stderr.readableLength && !stderr) {
                        let chunk;
                        while ((chunk = proc.stderr.read()) !== null) {
                            ERR += '' + chunk;
                        }
                    }
                }
                this.emit('exit', proc);
            });

            // Note: Fully exited, stdio closed
            proc.once('close', (code, signal) => {
                this.running = false;
                // Note: Handle output from exec
                if (type === 'exec') {
                    if (output.stdout && stdout) {
                        stdout.push(output.stdout);
                    }
                    if (output.stderr) {
                        if (stderr) {
                            stderr.push(output.stderr);
                        } else if (!ERR) {
                            ERR = output.stderr;
                        }
                    }
                }
                if (code !== 0) {
                    if (ERR) {
                        this.emit('error', new WatchError('Process exited with non-zero exit code: %d\n%s', code, ERR.stack || ERR), proc, code);
                    } else {
                        this.emit('error', new WatchError('Process exited with non-zero exit code: %d', code), proc, code);
                    }
                }
                this.emit('close', proc);
            });

            proc.on('error', err => {
                // Note: Catch spawn errors from spawn
                if (proc.pid === undefined && 'errno' in err) {
                    ERR = err;
                } else {
                    this.emit('error', err, proc);
                }
            });

            this.proc = proc;
            this.running = true;
        }
    }

    start () {
        let { watch, src, ignore, exts, cwd, debounce } = this.opts;
        if (!this.promise) {
            this.promise = Promise.withResolvers();
        }
        if (!this.watcher && watch) {
            this.watcher = watcher({ src, ignore, exts, cwd, debounce }, this.trigger.bind(this));
        }
        this.spawn();
        return this.promise.promise;
    }

    async restart () {
        await this.kill();
        this.spawn();
    }

    async close () {
        await this.kill({ exit: true });
    }

    kill ({ signal=this.opts.signal, exit=false }={}) {
        return new Promise((resolve, reject) => {
            if (exit) {
                this.watcher.close();
            }
            if (this.running) {
                this.proc.once('close', () => {
                    resolve();
                    if (exit) {
                        this.emit('done');
                        this.promise.resolve();
                    }
                });
                this.proc.once('error', err => {
                    reject(err);
                    if (exit) {
                        this.emit('done');
                        this.promise.reject(err);
                    }
                });
                this.proc.kill(signal);
            } else {
                resolve();
                if (exit) {
                    this.emit('done');
                    this.promise.resolve();
                }
            }
        });
    }

    trigger (paths, event) {
        this.emit('change', paths, event);
        if (this.opts.restart) {
            this.restart();
        }
    }

    static factory (defs) {
        return function factory (opts) {
            return new Watchmon({ ...defs, ...opts });
        };
    }

}

export const watchmon = Watchmon.factory();
