import path from 'path';
import Task from './task';
import logger from './logger';
import fs from 'fs';

/**
 * Checks that the artifact files for `task` matches what is contained in the build-info file.
 * @param task - The task for which to check artifact integrity.
 */
export function checkLinks(task: Task): void {
  const filePath = path.join(task.dir(), `readme.md`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  if (fileExists) {
    const readmeContents = fs.readFileSync(filePath).toString();
    const lines = readmeContents.split('\n');
    // Look for *local* links only: "./" or "../"
    // ./ must be files; ../ can be files or directories.
    // This will skip external links (e.g., to forum posts), which we cannot verify.
    const linkRegex = /\[(.*?)\]\((\.\.?\/.*?)\)/g;
    let linkCnt = 0;

    for (const line of lines) {
      let match;
      while ((match = linkRegex.exec(line))) {
        const text = match[1];
        const link = match[2];

        const linkPath = path.join(task.dir(), link);
        if (!fs.existsSync(linkPath) || (link[1] === '/' && !fs.statSync(linkPath).isFile())) {
          throw Error(`Broken link to '${text}' in task '${task.id}': ('${link}')`);
        }

        linkCnt++;
      }
    }

    if (linkCnt > 0) {
      logger.success(`Verified ${linkCnt} links in task '${task.id}'`);
    }
  } else {
    const isTopLevelFolder = ['deprecated', 'scripts'].includes(path.basename(task.dir()));
    if (!isTopLevelFolder) {
      throw Error(`Missing readme.md for task '${task.id}'`);
    }
  }
}

export function checkMainReadme(): void {
  const filePath = path.join(__dirname, `../readme.md`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  if (fileExists) {
    const readmeContents = fs.readFileSync(filePath).toString();
    const lines = readmeContents.split('\n');
    // This will look for local links only: "./" - which are assumed to be directories
    // This will skip external links (e.g., to forum posts), which we cannot verify.
    const linkRegex = /\[(.*?)\]\((\.\/.*?)\)/g;
    let linkCnt = 0;

    const rootPath = path.join(__dirname, `../`);

    for (const line of lines) {
      let match;
      while ((match = linkRegex.exec(line))) {
        const text = match[1];
        const link = match[2];

        const linkPath = path.join(rootPath, link);
        if (!fs.existsSync(linkPath)) {
          throw Error(`Broken link to '${text}' in main readme.md: ('${link}')`);
        }

        linkCnt++;
      }
    }

    logger.success(`Verified ${linkCnt} links in the main readme.md`);
  }
  else {
    throw Error(`Missing main /deployments readme.md`);
  }
}
