import { concat, defaults, each, isFunction, isObject, join, map, noop, resolve } from 'lo';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import process from 'node:process';
import picomatch from 'picomatch';

// Return true if path exists and is a directory
function isDir (path) {
    return !!fs.statSync(path, { throwIfNoEntry: false })?.isDirectory();
}

// Convert path to forward slashes (picomatch)
function toPosix (path) {
    return sep === '/' ? path : path.split(sep).join('/');
}

// Default exclude list
const IGNORE = ['**/.git/**', '**/node_modules/**'];

const defs = {
    src: undefined,
    ignore: undefined,
    defaultIgnore: true,
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

        let { src, ignore, defaultIgnore, include, exclude, exts, cwd, bash, dot, posix, regex, persistent, recursive } = opts;

        let glob, ext, watched = [], patterns = [];

        if (!paths) {
            paths = src || cwd || defs.cwd;
        }

        each(paths, path => {
            let def = picomatch.scan(path);
            let base = resolve(def.base, cwd);
            let dir = base;
            glob |= def.isGlob;
            // Note: Plain directories match everything below them, plain files only match themselves
            if (!def.isGlob) {
                if (isDir(base)) {
                    let rel = toPosix(relative(cwd, base));
                    path = rel ? rel + '/**' : '**';
                } else {
                    dir = dirname(base);
                }
            }
            patterns.push(path);
            watched.push({ base, dir });
        });

        // Note: Recursive watching already covers bases nested inside another base
        if (recursive) {
            watched = watched.filter(({ base }) => {
                return !watched.some(other => other.base !== base && base.startsWith(other.base + sep));
            });
        }

        if (!include && (src || glob)) {
            include = picomatch(src || patterns, { bash, dot, posix, regex });
        }

        // Note: Ignore patterns extend the default list (custom exclude fn replaces both)
        if (!exclude && (ignore || defaultIgnore)) {
            let ignored = defaultIgnore ? concat(IGNORE, ignore || []) : ignore;
            exclude = picomatch(ignored, { bash, dot, posix, regex });
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

        this.watchers = map(watched, ({ base, dir }) => {
            // Note: Fs.watch reports paths relative to base, matchers and callers expect cwd relative
            let rebase = filename => toPosix(relative(cwd, resolve(filename, dir)));
            let watcher = fs.watch(base, {
                persistent,
                recursive,
                signal: this.ac.signal,
                // Note: Node walks the tree in js on linux, pruning excluded dirs avoids a watcher per file below them
                ignore: exclude ? filename => this.isExcluded(rebase(filename)) : undefined
            }, (event, filename) => {
                if (filename) {
                    this.handle(event, rebase(filename));
                }
            });
            watcher.on('error', err => {
                this.emit('error', err, base);
            });
            return watcher;
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
        if (path && this.isWatched(path)) {
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
        };
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
