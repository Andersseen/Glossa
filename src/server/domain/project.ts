import {
  validateProjectRecord,
  type ProjectRecord,
} from '../cms/collections/projects';

export function defineProject(project: ProjectRecord): ProjectRecord {
  return validateProjectRecord(project);
}
