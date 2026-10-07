import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Watchmon } from '../index.js';

const DEBOUNCE = 50;

function wait (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Writable that collects everything written to it
function capture () {
    let stream = new PassThrough();
    stream.data = '';
    stream.on('data', chunk => stream.data += chunk);
    return stream;
}

describe('Watchmon', () => {

    let dir, sink, mon;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'watchmon-'));
        writeFileSync(join(dir, 'index.js'), `setInterval(() => {}, 1000);`);
        writeFileSync(join(dir, 'argv.js'), `process.stdout.write(JSON.stringify(process.execArgv));`);
        writeFileSync(join(dir, 'fail.js'), `process.exit(3);`);
        sink = capture();
    });

    afterEach(async () => {
        await mon?.close();
        mon = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    function create (opts) {
        mon = new Watchmon({ cwd: dir, watch: false, signals: false, stdout: sink, stderr: sink, ...opts });
        return mon;
    }

    it('should not emit error on restart', async () => {
        let errors = [];
        create().on('error', err => errors.push(err));
        await once(mon, 'spawn');
        await mon.restart();
        await once(mon, 'spawn');
        expect(errors).to.deep.equal([]);
        expect(mon.running).to.equal(true);
    });

    it('should not emit error on kill', async () => {
        let errors = [];
        create().on('error', err => errors.push(err));
        await once(mon, 'spawn');
        await mon.kill();
        expect(errors).to.deep.equal([]);
        expect(mon.running).to.equal(false);
    });

    it('should pass code and signal to close and exit events', async () => {
        create();
        await once(mon, 'spawn');
        let exit = once(mon, 'exit');
        let close = once(mon, 'close');
        await mon.kill();
        let [proc, code, signal] = await close;
        expect(proc).to.equal(mon.proc);
        expect(code).to.equal(null);
        expect(signal).to.equal('SIGTERM');
        expect((await exit).slice(1)).to.deep.equal([null, 'SIGTERM']);
    });

    it('should use killSignal when killing', async () => {
        create({ killSignal: 'SIGINT' });
        await once(mon, 'spawn');
        let close = once(mon, 'close');
        await mon.kill();
        expect((await close)[2]).to.equal('SIGINT');
    });

    it('should emit error when the process exits non-zero on its own', async () => {
        create({ cmd: 'fail' });
        let [err, proc, code] = await once(mon, 'error');
        expect(err.message).to.include('exit code: 3');
        expect(proc).to.equal(mon.proc);
        expect(code).to.equal(3);
    });

    it('should emit error when the process is killed externally', async () => {
        create();
        await once(mon, 'spawn');
        let error = once(mon, 'error');
        process.kill(mon.proc.pid, 'SIGKILL');
        let [err, , code, signal] = await error;
        expect(err.message).to.include('signal: SIGKILL');
        expect(code).to.equal(null);
        expect(signal).to.equal('SIGKILL');
    });

    it('should write exec output to the stdout stream', async () => {
        create({ type: 'exec', cmd: 'echo hi' });
        await once(mon, 'close');
        expect(sink.data).to.equal('hi\n');
    });

    it('should write exec stderr to the stderr stream', async () => {
        let err = capture();
        create({ type: 'exec', cmd: 'echo oops 1>&2', stderr: err });
        await once(mon, 'close');
        expect(err.data).to.equal('oops\n');
    });

    it('should pass execArgv to a forked process', async () => {
        create({ cmd: 'argv', execArgv: ['--no-warnings'] });
        await once(mon, 'close');
        expect(JSON.parse(sink.data)).to.include('--no-warnings');
    });

    it('should accept execArgs as an alias for execArgv', async () => {
        create({ cmd: 'argv', execArgs: ['--no-warnings'] });
        await once(mon, 'close');
        expect(JSON.parse(sink.data)).to.include('--no-warnings');
    });

    it('should close when watch is disabled', async () => {
        create();
        await once(mon, 'spawn');
        let done = once(mon, 'done');
        await mon.close();
        await done;
        expect(mon.running).to.equal(false);
    });

    it('should close before start', async () => {
        create({ start: false });
        await mon.close();
        expect(mon.running).to.equal(false);
    });

    it('should resolve the start promise on close', async () => {
        create({ start: false });
        let started = mon.start();
        await once(mon, 'spawn');
        await mon.close();
        await started;
    });

    it('should register and remove signal handlers', async () => {
        let before = process.listenerCount('SIGINT');
        create({ signals: ['SIGINT'] });
        expect(process.listenerCount('SIGINT')).to.equal(before + 1);
        expect(process.listenerCount('SIGTERM')).to.equal(0);
        await once(mon, 'spawn');
        await mon.close();
        expect(process.listenerCount('SIGINT')).to.equal(before);
    });

    it('should not register signal handlers when signals is false', () => {
        let before = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
        create({ signals: false });
        expect(process.listenerCount('SIGINT') + process.listenerCount('SIGTERM')).to.equal(before);
    });

    it('should restart on file change', async () => {
        create({ watch: true, src: '**', exts: ['js'], debounce: DEBOUNCE });
        let [first] = await once(mon, 'spawn');
        await wait(DEBOUNCE);
        let change = once(mon, 'change');
        let respawn = once(mon, 'spawn');
        writeFileSync(join(dir, 'index.js'), `setInterval(() => {}, 1000); // changed`);
        let [paths] = await change;
        let [second] = await respawn;
        expect(paths).to.deep.equal(['index.js']);
        expect(second.pid).to.not.equal(first.pid);
    });

    it('should not restart on file change when restart is disabled', async () => {
        create({ watch: true, src: '**', exts: ['js'], debounce: DEBOUNCE, restart: false });
        let [first] = await once(mon, 'spawn');
        await wait(DEBOUNCE);
        let change = once(mon, 'change');
        writeFileSync(join(dir, 'index.js'), `setInterval(() => {}, 1000); // changed`);
        await change;
        await wait(DEBOUNCE);
        expect(mon.proc).to.equal(first);
    });

});
