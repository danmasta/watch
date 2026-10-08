import { defaults, each, noop } from 'lo';
import { exec, fork, spawn } from 'node:child_process';
import EventEmitter from 'node:events';
import { constants } from 'node:os';
import process from 'node:process';
import { WatchError } from './util.js';
import { watcher } from './watcher.js';

const defs = {
    type: 'fork',
    cmd: 'index',
    args: undefined,
    src: '**',
    ignore: undefined,
    defaultIgnore: true,
    exts: undefined,
    cwd: process.cwd(),
    uid: undefined,
    gid: undefined,
    env: process.env,
    shell: undefined,
    killSignal: 'SIGTERM',
    killTimeout: undefined,
    signals: ['SIGINT', 'SIGTERM'],
    exitCode: true,
    stdin: undefined,
    stdout: process.stdout,
    stderr: process.stderr,
    execPath: undefined,
    execArgv: undefined,
    execArgs: undefined,
    debounce: undefined,
    watch: true,
    start: true,
    restart: true
};

export class Watchmon extends EventEmitter {

    constructor (opts) {

        super();

        let { start, signals } = this.opts = opts = defaults(opts, defs);

        this.running = false;
        this.killing = false;
        this.proc = null;
        this.promise = null;
        this.closing = null;
        this.handlers = new Map();

        // Note: Prevent uncaught exception from error events
        this.on('error', noop);

        // Note: Handlers stay registered until the child closes
        // Note: Repeat signals are forwarded instead of killing the supervisor
        if (signals) {
            each(signals, sig => {
                let handler = () => {
                    this.kill({ signal: sig, exit: true }).catch(err => this.emit('error', err));
                };
                this.handlers.set(sig, handler);
                process.on(sig, handler);
            });
        }

        if (start) {
            this.start();
        }

    }

    spawn () {
        if (!this.running) {

            let { type, cmd, args, cwd, env, execPath, execArgv, execArgs, uid, gid, shell, killSignal, stdin, stdout, stderr } = this.opts;
            let proc, ERR, output;

            switch (type) {
                case 'fork':
                    proc = fork(cmd, args, {
                        cwd,
                        env,
                        execPath,
                        execArgv: execArgv || execArgs,
                        uid,
                        gid,
                        killSignal,
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
                        killSignal,
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
                            killSignal
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
                if (type === 'fork' && code !== 0 && proc.stderr.readableLength && !stderr) {
                    let chunk, buf = '';
                    while ((chunk = proc.stderr.read()) !== null) {
                        buf += chunk;
                    }
                    ERR = ERR || buf;
                }
                this.emit('exit', proc, code, signal);
            });

            // Note: Fully exited, stdio closed
            proc.once('close', (code, signal) => {
                let killed = this.killing;
                this.killing = false;
                this.running = false;
                // Note: Handle output from exec
                if (type === 'exec') {
                    if (output.stdout && stdout) {
                        stdout.write(output.stdout);
                    }
                    if (output.stderr) {
                        if (stderr) {
                            stderr.write(output.stderr);
                        } else if (!ERR) {
                            ERR = output.stderr;
                        }
                    }
                }
                // Note: Exits we requested are skipped, anything else is emitted
                if (!killed && code !== 0) {
                    let reason = code === null ? `signal: ${signal}` : `exit code: ${code}`;
                    if (ERR) {
                        this.emit('error', new WatchError('Process exited with %s\n%s', reason, ERR.stack || ERR), proc, code, signal);
                    } else {
                        this.emit('error', new WatchError('Process exited with %s', reason), proc, code, signal);
                    }
                }
                this.emit('close', proc, code, signal);
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
        let { watch, src, ignore, defaultIgnore, exts, cwd, debounce } = this.opts;
        if (!this.promise) {
            this.promise = Promise.withResolvers();
            // Note: Prevent unhandled rejection if not awaited
            this.promise.promise.catch(noop);
        }
        if (!this.watcher && watch) {
            this.watcher = watcher({ src, ignore, defaultIgnore, exts, cwd, debounce }, this.trigger.bind(this));
        }
        this.spawn();
        return this.promise.promise;
    }

    async restart () {
        // Note: Skip respawn once shutdown has started
        if (this.closing) {
            return;
        }
        await this.kill();
        this.spawn();
    }

    async close () {
        await this.kill({ exit: true });
    }

    kill ({ signal=this.opts.killSignal, exit=false }={}) {
        // Note: Repeat signals while closing are forwarded to the child, which should
        // handle signal duplication and/or force quit itself
        if (exit && this.closing) {
            if (this.running) {
                this.proc.kill(signal);
            }
            return this.closing;
        }
        let { killTimeout, exitCode } = this.opts;
        let promise = new Promise((resolve, reject) => {
            let settled = false;
            let timer;
            let settle = (err, code, sig) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
                if (exit) {
                    each(this.handlers, (handler, name) => process.off(name, handler));
                    this.handlers.clear();
                    this.closing = null;
                    // Note: Pass the child's exit status through (signals map to 128 + number)
                    if (exitCode && !process.exitCode) {
                        if (code) {
                            process.exitCode = code;
                        } else if (sig) {
                            process.exitCode = 128 + constants.signals[sig];
                        }
                    }
                    this.emit('done', code, sig);
                    if (err) {
                        this.promise?.reject(err);
                    } else {
                        this.promise?.resolve();
                    }
                }
            };
            if (exit) {
                this.watcher?.close();
            }
            if (this.running) {
                let proc = this.proc;
                this.killing = true;
                proc.once('close', (code, sig) => settle(null, code, sig));
                proc.once('error', settle);
                proc.kill(signal);
                // Note: Escalate to SIGKILL if the child ignores the signal
                if (killTimeout) {
                    timer = setTimeout(() => proc.kill('SIGKILL'), killTimeout);
                }
            } else {
                settle();
            }
        });
        if (exit) {
            this.closing = promise;
        }
        return promise;
    }

    trigger (paths, event) {
        this.emit('change', paths, event);
        if (this.opts.restart) {
            this.restart().catch(err => this.emit('error', err));
        }
    }

    static factory (defs) {
        return function factory (opts) {
            return new Watchmon({ ...defs, ...opts });
        };
    }

}

export const watchmon = Watchmon.factory();
