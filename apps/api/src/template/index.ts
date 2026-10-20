/**
 * Public surface of the `template` module (M2).
 *
 * Other modules -- and the HTTP layer -- import from here rather than from individual files, so the
 * internal layout stays free to change. Same shape as `auth/index.ts` and `family/index.ts`.
 */
export type {
  AssignMode,
  ClaimerScope,
  Clock,
  CreateTemplateInput,
  MembershipReader,
  TaskTemplateRecord,
  TemplateRepository,
  TemplateStatus,
  TemplateSummary,
} from './types.js';

export { TemplateError, toErrorBody } from './errors.js';
export type { ErrorBody, TemplateErrorCode } from './errors.js';

export {
  formatRepeatRule,
  isValidRepeatRule,
  isoWeekday,
  matchesDate,
  parseRepeatRule,
  shouldFireOn,
} from './repeat.js';
export type { RepeatRule } from './repeat.js';

export { createInMemoryTemplateRepository } from './repository.js';
export type {
  InMemoryTemplateRepository,
  InMemoryTemplateRepositoryOptions,
} from './repository.js';

export {
  DEFAULT_ASSIGN_MODE,
  DEFAULT_CLAIMER_SCOPE,
  DEFAULT_MUST_BE_CLAIMED,
  DEFAULT_REMIND_BEFORE_MIN,
  REMIND_BEFORE_MIN_MAX,
  REMIND_BEFORE_MIN_MIN,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_TITLE_MAX_LENGTH,
  createTemplateService,
  normalizeCreateTemplateInput,
  toTemplateSummary,
} from './service.js';
export type {
  CreateTemplateRequest,
  CreateTemplateServiceOptions,
  NormalizedTemplateInput,
  TemplateListFilter,
  TemplateService,
  TemplateSettableStatus,
} from './service.js';
