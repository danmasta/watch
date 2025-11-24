import { BaseError } from 'lo/errors';

export class WatchError extends BaseError {
    static code = 'ERR_WATCH';
}
