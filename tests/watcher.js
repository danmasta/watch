import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watch } from '../index.js';

const DEBOUNCE = 50;

function wait (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Resolves with the change event args, or undefined if nothing fires in time
function change (watcher, ms=DEBOUNCE * 4) {
    return Promise.race([
        once(watcher, 'change'),
        wait(ms)
    ]);
}

// Resolves after watchers have been created
function ready () {
    return wait(DEBOUNCE);
}

describe('Watcher', () => {

    let dir, watcher;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'watch-'));
        mkdirSync(join(dir, 'src/deep'), { recursive: true });
        mkdirSync(join(dir, 'lib'), { recursive: true });
        mkdirSync(join(dir, 'tests'), { recursive: true });
        writeFileSync(join(dir, 'src/a.js'), '');
        writeFileSync(join(dir, 'src/a.txt'), '');
        writeFileSync(join(dir, 'src/deep/b.js'), '');
        writeFileSync(join(dir, 'lib/c.js'), '');
        writeFileSync(join(dir, 'tests/d.js'), '');
    });

    afterEach(() => {
        watcher?.close();
        watcher = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    it('should match nested paths under a positive glob', async () => {
        watcher = watch('src/**', { cwd: dir, debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'src/deep/b.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['src/deep/b.js']);
    });

    it('should emit cwd relative paths', async () => {
        watcher = watch('src/**', { cwd: dir, debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'src/a.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['src/a.js']);
    });

    it('should watch a single file', async () => {
        watcher = watch('src/a.js', { cwd: dir, debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'src/a.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['src/a.js']);
    });

    it('should watch a plain directory recursively', async () => {
        watcher = watch('src', { cwd: dir, debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'src/deep/b.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['src/deep/b.js']);
    });

    it('should expand plain directories when mixed with globs', async () => {
        watcher = watch(['src', 'lib/**'], { cwd: dir, debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'src/deep/b.js'), 'x');
        writeFileSync(join(dir, 'lib/c.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.have.members(['src/deep/b.js', 'lib/c.js']);
    });

    it('should filter by extension', async () => {
        watcher = watch('src/**', { cwd: dir, exts: ['js'], debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'src/a.txt'), 'x');
        writeFileSync(join(dir, 'src/a.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['src/a.js']);
    });

    it('should ignore paths matching ignore globs', async () => {
        watcher = watch('**', { cwd: dir, ignore: 'tests/**', debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'tests/d.js'), 'x');
        let res = await change(watcher);
        expect(res).to.equal(undefined);
    });

    it('should emit a single path string when debounce is disabled', async () => {
        watcher = watch('src/**', { cwd: dir, debounce: 0 });
        await ready();
        writeFileSync(join(dir, 'src/a.js'), 'x');
        let [path, event] = await change(watcher);
        expect(path).to.equal('src/a.js');
        expect(event).to.be.a('string');
    });

    it('should collapse bases nested inside another base', async () => {
        watcher = watch(['src', 'src/deep/**'], { cwd: dir, debounce: DEBOUNCE });
        expect(watcher.watchers).to.have.length(1);
        await ready();
        writeFileSync(join(dir, 'src/deep/b.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['src/deep/b.js']);
    });

    it('should ignore null filenames', () => {
        watcher = watch('src/**', { cwd: dir, debounce: 0 });
        let called = false;
        watcher.on('change', () => called = true);
        expect(() => watcher.handle('change', null)).to.not.throw();
        expect(called).to.equal(false);
    });

    it('should stop emitting after close', async () => {
        watcher = watch('src/**', { cwd: dir, debounce: DEBOUNCE });
        await ready();
        watcher.close();
        writeFileSync(join(dir, 'src/a.js'), 'x');
        let res = await change(watcher);
        expect(res).to.equal(undefined);
    });

    it('should call the callback argument on change', async () => {
        let args = new Promise(resolve => {
            watcher = watch('src/**', { cwd: dir, debounce: DEBOUNCE }, (...a) => resolve(a));
        });
        await ready();
        writeFileSync(join(dir, 'src/a.js'), 'x');
        let [paths] = await args;
        expect(paths).to.deep.equal(['src/a.js']);
    });

    it('should ignore node_modules and .git in addition to ignore patterns', async () => {
        mkdirSync(join(dir, 'node_modules'));
        mkdirSync(join(dir, '.git'));
        writeFileSync(join(dir, 'node_modules/x.js'), '');
        writeFileSync(join(dir, '.git/HEAD'), '');
        watcher = watch('**', { cwd: dir, ignore: 'tests/**', debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'node_modules/x.js'), 'x');
        writeFileSync(join(dir, '.git/HEAD'), 'x');
        writeFileSync(join(dir, 'tests/d.js'), 'x');
        let res = await change(watcher);
        expect(res).to.equal(undefined);
        writeFileSync(join(dir, 'src/a.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['src/a.js']);
    });

    it('should watch node_modules when defaultIgnore is false', async () => {
        mkdirSync(join(dir, 'node_modules'));
        writeFileSync(join(dir, 'node_modules/x.js'), '');
        watcher = watch('**', { cwd: dir, defaultIgnore: false, debounce: DEBOUNCE });
        await ready();
        writeFileSync(join(dir, 'node_modules/x.js'), 'x');
        let [paths] = await change(watcher);
        expect(paths).to.deep.equal(['node_modules/x.js']);
    });

    it('should prune excluded directories from the walk', async function () {
        // Note: Only the js recursive watcher on linux consults the matcher while walking
        if (process.platform !== 'linux') {
            this.skip();
        }
        let seen = [];
        mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
        writeFileSync(join(dir, 'node_modules/pkg/index.js'), '');
        watcher = watch('**', {
            cwd: dir,
            exclude: path => {
                seen.push(path);
                return path.startsWith('node_modules');
            },
            debounce: DEBOUNCE
        });
        await ready();
        expect(seen).to.include('node_modules');
        expect(seen).to.not.include('node_modules/pkg');
        expect(seen).to.not.include('node_modules/pkg/index.js');
    });

});
