/** Public surface of the instances module. Routes import from here, never from internals. */

export {
  TERMINAL_STATUSES,
  OPEN_STATUSES,
} from './types.js';
export type {
  ClaimPatch,
  CreateInstanceInput,
  InstanceRepository,
  InstanceStatus,
  SettledBy,
  SettlementPatch,
  TaskInstanceRecord,
} from './types.js';

export { InstanceError } from './errors.js';
export type { ErrorBody, InstanceErrorCode } from './errors.js';

export {
  FREE_CANCEL_WINDOW_MS,
  canTransition,
  isLive,
  isOverdue,
  isTerminal,
  isWithinFreeCancel,
  nextStatuses,
} from './state.js';
export type { TransitionVerdict } from './state.js';

export { createInMemoryInstanceRepository } from './repository.js';
export type {
  InMemoryInstanceRepository,
  InMemoryInstanceRepositoryOptions,
} from './repository.js';

export { createInstanceService } from './service.js';
export type { CreateInstanceServiceOptions, InstanceService } from './service.js';

export { createPrismaInstanceRepository } from './repository.prisma.js';
export type {
  PrismaInstanceClient,
  PrismaInstanceRow,
  PrismaTaskInstanceDelegate,
} from './repository.prisma.js';
