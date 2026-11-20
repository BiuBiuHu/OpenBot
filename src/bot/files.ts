import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BotError } from './contracts.js';
export class WorkspaceFiles {
  readonly root: string;
  constructor(root: string) { fs.mkdirSync(root, { recursive: true }); this.root = fs.realpathSync(root); }
  resolve(relative: string) {
    if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new BotError('Invalid workspace path');
    const target = fs.realpathSync(path.join(this.root, relative || '.'));
    if (target !== this.root && !target.startsWith(this.root + path.sep)) throw new BotError('Path leaves workspace', 403);
    return target;
  }
  list(relative = '') {
    const dir = this.resolve(relative);
    if (!fs.statSync(dir).isDirectory()) throw new BotError('Not a directory');
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => !e.isSymbolicLink()).slice(0, 200).map(e => ({ name: e.name, path: path.join(relative, e.name), type: e.isDirectory() ? 'directory' : 'file' }));
  }
  read(relative: string) {
    const target = this.resolve(relative);
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) throw new BotError('Not a regular file');
      if (stat.size > 1024 * 1024) throw new BotError('File exceeds 1 MiB preview limit', 413);
      const data = fs.readFileSync(fd);
      return { path: relative, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), content: data.toString('utf8') };
    } finally { fs.closeSync(fd); }
  }
}
