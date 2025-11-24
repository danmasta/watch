import { concat, defaults, each, isFunction, isObject, join, map, noop, resolve } from 'lo';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import process from 'node:process';
import picomatch from 'picomatch';

const defs = {
    src: undefined,
    ignore: undefined,
    exts: undefined,
    include: undefined,
    exclude: undefined,
    cwd: process.cwd(),
    bash: false,
    dot: true,
    posix: false,
    regex: false,
    events: ['rename', 'change'],
    recursive: true,
    persistent: true,
    debounce: 256
};

// Note: Fs.watch emits two events: rename and change
// rename = create/delete
// change = everything else (including renaming)
export class Watcher extends EventEmitter {

    constructor (paths, opts, fn) {

        super();

        if (isFunction(opts)) {
            [opts, fn] = [fn, opts];
        }

        if (isFunction(paths)) {
            [paths, fn] = [undefined, paths];
        }

        if (isObject(paths)) {
            [paths, opts] = [opts, paths];
        }

        this.opts = opts = defaults(opts, defs);

        let { src, ignore, include, exclude, exts, cwd, bash, dot, posix, regex, persistent, recursive } = opts;

        let glob, ext, watched = new Set();

        if (!paths) {
            paths = src || cwd || defs.cwd;
        }

        each(paths, path => {
            let def = picomatch.scan(path);
            glob |= def.isGlob;
            watched.add(resolve(def.base, cwd));
        });

        if (!include && (src || glob)) {
            include = picomatch(src || paths, { bash, dot, posix, regex });
        }

        if (!exclude && ignore) {
            exclude = picomatch(ignore, { bash, dot, posix, regex });
        }

        if (exts) {
            ext = picomatch(`**/**.(${join(concat(exts), '|')})`);
        }

        this.paths = paths;
        this.watched = watched;
        this.include = include;
        this.exclude = exclude;
        this.ext = ext;
        this.ac = new AbortController();

        this.watchers = map(watched, path => {
            return fs.watch(path, {
                persistent,
                recursive,
                signal: this.ac.signal
            }, this.handle.bind(this));
        });

        if (isFunction(fn) && fn !== noop) {
            this.on('change', fn);
        }

        this.changed = new Set();
        this.trigger = Watcher.trigger.call(this, opts.debounce);

    }

    isIncluded (str) {
        return !this.include || this.include(str);
    }

    isExcluded (str) {
        return !!this.exclude && this.exclude(str);
    }

    isExt (str) {
        return !this.ext || this.ext(str);
    }

    isWatched (str) {
        return this.isIncluded(str) && !this.isExcluded(str) && this.isExt(str);
    }

    close () {
        this.ac.abort('close');
    }

    handle (event, path) {
        if (this.isWatched(path)) {
            this.trigger(event, path);
        }
    }

    static trigger (debounce) {
        let timer;
        return (event, path) => {
            if (debounce) {
                this.changed.add(path);
                if (timer) {
                    clearTimeout(timer);
                }
                timer = setTimeout(() => {
                    let paths = Array.from(this.changed);
                    this.changed.clear();
                    this.emit('change', paths, event);
                }, debounce);
            } else {
                this.emit('change', path, event);
            }
        }
    }

    static factory () {
        return function factory (...args) {
            return new Watcher(...args);
        };
    }

}

export const watcher = Watcher.factory();

export {
    watcher as watch
};
