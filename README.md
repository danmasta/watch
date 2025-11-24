# Watch
Simple file watching and process reload supervisor utility

#### Features:
* Easy to use
* Support for glob pattern matching
* Support for callbacks and events
* Watch directories and files
* Process supervisor for auto reloading
* Support for multiple exec types (`fork`, `spawn`, `exec`)
* 1 external dependency

## About
Utility library for watching files and reloading processes on change. These utilites are modern, lighter-weight alternatives to packages like `chokidar` and `nodemon`. You can use them in your tools, build pipelines, or anywhere else you want to watch files and/or reload processes on change.

## Usage
Add watch as a dependency and install via npm
```bash
npm install watch@danmasta/watch --save
```
Install a specific [version](https://github.com/danmasta/watch/tags)
```bash
npm install watch@danmasta/watch#v0.0.0 --save
```
*See documentation regarding git dependencies [here](https://danmasta.github.io/lo/installation)*

Import functions in your app
```js
import { watch, watchmon } from 'watch';
```

## Documentation
### Watcher
`Watcher` is the base file watching class. It supports many options including glob matching, file extension filtering, and debouncing.

Signature:
```js
watch(paths?, opts?, fn?);
```

#### Options
Name | Type | Description
-----|----- | -----------
`src` | *`string\|string[]`* | Source paths to watch, supports globs. Default is `process.cwd`
`ignore` | *`string\|string[]`* | Source paths to ignore, supports globs. Default is `undefined`
`exts` | *`string\|string[]`* | Extensions to include for watching. Default is `undefined`
`include` | *`function`* | Custom matcher function used to verify watched files. Default is `undefined`
`exclude` | *`function`* | Custom matcher function used to verify ignored files. Default is `undefined`
`cwd` | *`string`* | Base path to resolve relative paths from. Default is `process.cwd`
`bash` | *`boolean`* | Enable following bash matching rules more strictly (disallow backslashes as escape characters, and treat single stars as globstars `**`). Default is `false`
`dot` | *`boolean`* | Whether or not to include dot files when matching. Default is `true`
`posix` | *`boolean`* | Support posix character classes (brackets) when matching. Default is `false`
`regex` | *`boolean`* | Support regular expression rules for `+`, and stars `*` that follow parenthesis or brackets when matching. Default is `false`
`recursive` | *`boolean`* | Enable recursive watching for directories. Default is `true`
`persistent` | *`boolean`* | Keep process open while watcher is active. Default is `true`
`debounce` | *`number`* | Time in milliseconds to debounce events. If debounce is disabled, change events will be triggered for each underlying fs event and the paths callback argument will be a single path `string`. If enabled, the paths argument will be an `array` of changed paths during the time period. Default is `256`

#### Methods
Name | Description
-----|------------
`isIncluded(str)` | Check if a path is explicitly included in watching. Returns `boolean`
`isExcluded(str)` | Check if a path is explicitly excluded from watching. Returns `boolean`
`isExt(str)` | Check if a path's extension is explicitly included in watching. Returns `boolean`
`isWatched(str)` | Check if a path is included in watching. Verifies against `isIncluded`, `isExcluded`, and `isExt`. Returns `boolean`
`close()` | Abort internal watchers and stop watching

### Watchmon
`Watchmon` is a process supervisor that can watch files for changes and trigger a reload. It's highly customizable and supports multiple exec types, piping to stdin, piping from stdout and stderr, deferred start, shutdown signals, and manual start, stop, and restart. It uses the [`Watcher`](#watcher) class under the hood for file watching.

Signature:
```js
watchmon(opts?);
```

#### Options
Name | Type | Description
-----|----- | -----------
`type` | *`string`* | Exec type to use for [spawning processes](https://nodejs.org/docs/latest-v24.x/api/child_process.html#asynchronous-process-creation). Options are: `fork`, `spawn`, and `exec`. Default is `fork`
`cmd` | *`string`* | Entrypoint to use for spawned process. Default is `index`
`args` | *`string[]`* | Arguments to pass to spawned process. Default is `undefined`
`src` | *`string\|string[]`* | Source paths to watch, supports globs. Default is `**/**`
`ignore` | *`string\|string[]`* | Source paths to ignore, supports globs. Default is `(.git\|node_modules)/**`
`exts` | *`string\|string[]`* | Extensions to include for watching. Default is `undefined`
`cwd` | *`string`* | Working directory for spawned process. Also used to resolve relative paths for watching. Default is `process.cwd`
`uid` | *`number`* | User id for spawned process. Default is `undefined`
`gid` | *`number`* | Group id for spawned process. Default is `undefined`
`env` | *`object`* | Environment variables to pass to spawned process. Default is `process.env`
`shell` | *`string\|boolean`* | Which shell to use for spawned process. Used with `spawn` or `exec`. Default is `undefined`
`signal` | *`string`* | Default signal to use when stopping processes during restart or kill. Default is `SIGTERM`
`stdin` | *`stream`* | Readable stream to pipe to spawned process `stdin`. Default is `undefined`
`stdout` | *`stream`* | Writable stream to pipe spawned process `stdout` to. Default is `process.stdout`
`stderr` | *`stream`* | Writable stream to pipe spawned process `stderr` to. Default is `process.stderr`
`execPath` | *`string`* | Executable to use for spawning the process. Used with `fork`. Default is `undefined`
`execArgs` | *`string[]`* | Arguments to pass to executable. Used with `fork`. Default is `undefined`
`debounce` | *`number`* | Time in milliseconds to debounce events for triggering restart. Default is `256`
`watch` | *`boolean`* | Enable file watching. Default is `true`
`start` | *`boolean`* | Enable auto start process on creation. Default is `true`
`restart` | *`boolean`* | Enable restart on file change. Default is `true`

#### Methods
Name | Description
-----|------------
`spawn()` | Spawn process based on options, if not already spawned. Returns `undefined`
`start()` | Spawn process and return promise that resolves when the supervisor has exited. Returns `promise<undefined>`
`restart()` | Kill existing process then re-spawn. Returns `promise<undefined>`
`close()` | Kill existing process, abort watchers, and close supervisor. Emits a `done` event when shutdown complete. Returns a `promise` that resolves with `undefined` or rejects with an `error` if there was an error while terminating the process
`kill({ signal, exit })` | Kill existing process. Optionally abort watchers, and close supervisor. Returns a `promise` that resolves with `undefined` or rejects with an `error` if there was an error while terminating the process
`trigger(paths, event)` | Trigger a change event and restart. Returns `undefined`

## Examples
### Watcher
You can use the `Watcher` class directly, or use the factory functions `watcher` and `watch`
```js
import { Watcher, watcher, watch } from 'watch';
```
Watch current working directory for changes on any file type
```js
watch('**/**', paths => {
    console.log('Files changed:', paths);
});
```
Watch `src` directory for changes on `js` or `ts` file types
```js
watch('src', { exts: ['js', 'ts'] }, paths => {
    console.log('Files changed:', paths);
});
```
Watch root directory for changes on `js` file types and ignore `tests` directory using globs
```js
watch('**/**.js', { ignore: 'tests/**' }, paths => {
    console.log('Files changed:', paths);
});
```
Listen for change events on `src` directory
```js
const watcher = watch('src');

watcher.on('change', paths => {
    console.log('Files changed:', paths);
});
```

### Watchmon
You can use the `Watchmon` class directly, or use the factory function `watchmon`
```js
import { Watchmon, watchmon } from 'watch';
```
Run `index.js` using `fork`, watch for chages on `js` files in current directory, pipe output to `stdout`
```js
const server = watchmon({
    cmd: 'index',
    src: '**/**',
    exts: ['js']
});
```
Run `app.js` using `spawn`, watch for changes on `js` and `ts` files in current directory, pipe output to a pretty print stream
```js
const out = pretty();

const server = watchmon({
    type: 'spawn',
    cmd: 'node',
    args: ['app'],
    src: '**/**',
    exts: ['js', 'ts'],
    stdout: out,
    stderr: out,
    shell: '/bin/bash'
});
```
Use with `gulp` to create an auto-reloading dev server. Defer start, return `promise` to signal `done` in server task, listen to `done` event for other tasks. Pipe output to `stdout`
```js
import { task, parallel } from 'gulp';

const server = watchmon({
    cmd: 'app',
    src: '**/**',
    exts: ['js'],
    start: false
});

task('server', () => {
    return server.start();
});

task('watch', done => {
    const watchers = [
        ...
    ];
    server.once('done', () => {
        watchers.map(watcher => {
            watcher.close();
        });
        done();
    });
});

task('default', parallel('server', 'watch'));
```

## Testing
Tests are currently run using mocha and chai. To execute tests run `make test`. To generate unit test coverage reports run `make coverage`

## Contact
If you have any questions feel free to get in touch
