import type { Context } from 'koa';
import {
  getJwtService,
  isAdminRole,
  normalizeResidentAccessMode,
  type ResidentUserEntity,
} from './resident-session';

export const RESIDENT_ACCESS_STORE_KEY = 'resident-access';
export const DEFAULT_RESIDENT_LOGIN_DISABLED_MESSAGE =
  'El administrador esta preparando el informe.';

export type ResidentAccessConfig = {
  residentLoginDisabledMessage: string;
  residentLoginEnabled: boolean;
  residentUsersBlockedByClosure: number[];
  residentSessionRevokedAt: string | null;
  updatedAt: string | null;
  updatedByUserId: number | null;
};

type StrapiStore = {
  get: (params?: Record<string, unknown>) => Promise<unknown>;
  set: (input: { value: ResidentAccessConfig }) => Promise<unknown>;
};

type StrapiLike = {
  entityService?: {
    findMany: (uid: string, params?: Record<string, unknown>) => Promise<unknown>;
    update: (uid: string, id: number, params: Record<string, unknown>) => Promise<unknown>;
  };
  plugin: (name: string) => {
    service: (serviceName: string) => unknown;
  };
  store: (input: { key: string; name: string; type: string }) => StrapiStore;
};

const getResidentAccessStore = (strapi: StrapiLike) =>
  strapi.store({
    type: 'core',
    name: 'portal',
    key: RESIDENT_ACCESS_STORE_KEY,
  });

const normalizeDisabledMessage = (value: unknown) => {
  if (typeof value !== 'string') {
    return DEFAULT_RESIDENT_LOGIN_DISABLED_MESSAGE;
  }

  const normalizedValue = value.trim().replace(/\s+/g, ' ');

  if (!normalizedValue) {
    return DEFAULT_RESIDENT_LOGIN_DISABLED_MESSAGE;
  }

  return normalizedValue.slice(0, 280);
};

const normalizeIsoDate = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsedValue = new Date(value);

  if (Number.isNaN(parsedValue.getTime())) {
    return null;
  }

  return parsedValue.toISOString();
};

const normalizeIdList = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
};

const getEntityService = (strapi: StrapiLike) => {
  if (!strapi.entityService) {
    throw new Error('La capa de entityService de Strapi no está disponible.');
  }

  return strapi.entityService;
};

export const getResidentAccessConfig = async (
  strapi: StrapiLike
): Promise<ResidentAccessConfig> => {
  const storedConfig = (await getResidentAccessStore(strapi).get({})) as
    | Partial<ResidentAccessConfig>
    | null
    | undefined;

  return {
    residentLoginDisabledMessage: normalizeDisabledMessage(
      storedConfig?.residentLoginDisabledMessage
    ),
    residentLoginEnabled: storedConfig?.residentLoginEnabled !== false,
    residentUsersBlockedByClosure: normalizeIdList(
      storedConfig?.residentUsersBlockedByClosure
    ),
    residentSessionRevokedAt: normalizeIsoDate(
      storedConfig?.residentSessionRevokedAt
    ),
    updatedAt: normalizeIsoDate(storedConfig?.updatedAt),
    updatedByUserId:
      typeof storedConfig?.updatedByUserId === 'number' &&
      Number.isFinite(storedConfig.updatedByUserId)
        ? storedConfig.updatedByUserId
        : null,
  };
};

export const updateResidentAccessConfig = async (
  strapi: StrapiLike,
  input: {
    residentLoginDisabledMessage?: unknown;
    residentLoginEnabled?: unknown;
    updatedByUserId?: number | null;
  }
): Promise<ResidentAccessConfig> => {
  const currentConfig = await getResidentAccessConfig(strapi);
  const nextResidentLoginEnabled =
    typeof input.residentLoginEnabled === 'boolean'
      ? input.residentLoginEnabled
      : currentConfig.residentLoginEnabled;
  const entityService = getEntityService(strapi);
  let residentUsersBlockedByClosure = currentConfig.residentUsersBlockedByClosure;
  let residentSessionRevokedAt = currentConfig.residentSessionRevokedAt;

  if (!nextResidentLoginEnabled) {
    const users = (await entityService.findMany('plugin::users-permissions.user', {
      fields: ['id', 'blocked', 'provider'],
      populate: {
        role: {
          fields: ['id', 'name', 'type'],
        },
      },
    })) as ResidentUserEntity[];

    const residentUsersToBlock = users.filter(
      (user) =>
        user.provider === 'local' &&
        !isAdminRole(user.role) &&
        user.blocked !== true
    );

    if (residentUsersToBlock.length > 0) {
      residentUsersBlockedByClosure = Array.from(
        new Set([
          ...residentUsersBlockedByClosure,
          ...residentUsersToBlock.map((user) => user.id),
        ])
      );

      await Promise.all(
        residentUsersToBlock.map((user) =>
          entityService.update('plugin::users-permissions.user', user.id, {
            data: {
              blocked: true,
            },
          })
        )
      );
    }

    if (currentConfig.residentLoginEnabled || residentUsersToBlock.length > 0) {
      residentSessionRevokedAt = new Date().toISOString();
    }
  }

  if (!currentConfig.residentLoginEnabled && nextResidentLoginEnabled) {
    await Promise.all(
      currentConfig.residentUsersBlockedByClosure.map((userId) =>
        entityService.update('plugin::users-permissions.user', userId, {
          data: {
            blocked: false,
          },
        })
      )
    );

    residentUsersBlockedByClosure = [];
  }

  const nextConfig: ResidentAccessConfig = {
    residentLoginDisabledMessage: normalizeDisabledMessage(
      input.residentLoginDisabledMessage ??
        currentConfig.residentLoginDisabledMessage
    ),
    residentLoginEnabled: nextResidentLoginEnabled,
    residentUsersBlockedByClosure,
    residentSessionRevokedAt,
    updatedAt: new Date().toISOString(),
    updatedByUserId:
      typeof input.updatedByUserId === 'number' &&
      Number.isFinite(input.updatedByUserId)
        ? input.updatedByUserId
        : currentConfig.updatedByUserId,
  };

  await getResidentAccessStore(strapi).set({ value: nextConfig });

  return nextConfig;
};

export const isResidentSessionToken = (payload: Record<string, unknown> | null) =>
  Boolean(normalizeResidentAccessMode(payload?.residentAccessMode));

export const isResidentSessionRevoked = (
  payload: Record<string, unknown> | null,
  config: ResidentAccessConfig
) => {
  if (!config.residentSessionRevokedAt || !isResidentSessionToken(payload)) {
    return false;
  }

  const revokedAtTimestamp = new Date(config.residentSessionRevokedAt).getTime();
  const tokenIssuedAt = Number(payload?.iat);

  if (!Number.isFinite(revokedAtTimestamp) || revokedAtTimestamp <= 0) {
    return false;
  }

  if (!Number.isFinite(tokenIssuedAt) || tokenIssuedAt <= 0) {
    return true;
  }

  return tokenIssuedAt * 1000 <= revokedAtTimestamp;
};

export const ensureResidentSessionIsActive = async (
  strapi: StrapiLike,
  ctx: Context
) => {
  const tokenPayload = (await getJwtService(strapi as any).getToken(ctx)) as
    | Record<string, unknown>
    | null;

  if (!isResidentSessionToken(tokenPayload)) {
    return null;
  }

  const config = await getResidentAccessConfig(strapi);

  if (!config.residentLoginEnabled || isResidentSessionRevoked(tokenPayload, config)) {
    return ctx.unauthorized(config.residentLoginDisabledMessage);
  }

  return null;
};
