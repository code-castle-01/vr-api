import { factories } from '@strapi/strapi';
import type { Context } from 'koa';
import { getResidentAccessModeFromContext } from '../../../utils/resident-session';

type ProxyAuthorizationService = {
  getSummary: (userId: number, accessMode: 'owner' | 'proxy') => Promise<unknown>;
  listAvailableResidents: (userId: number, accessMode: 'owner' | 'proxy') => Promise<unknown>;
  listByAssembly: (userId: number, assemblyId: number) => Promise<unknown>;
  removeDeclaration: (
    userId: number,
    accessMode: 'owner' | 'proxy',
    declarationId: number
  ) => Promise<unknown>;
  submitDeclarations: (
    userId: number,
    accessMode: 'owner' | 'proxy',
    payload: unknown,
    files: unknown
  ) => Promise<unknown>;
  lockRepresentation: (
    userId: number,
    accessMode: 'owner' | 'proxy'
  ) => Promise<unknown>;
  revokeDeclaration: (
    adminUserId: number,
    declarationId: number,
    reason: unknown
  ) => Promise<unknown>;
};

export default factories.createCoreController(
  'api::proxy-authorization.proxy-authorization',
  ({ strapi }) => ({
    async mine(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar tus poderes.');
      }

      const accessMode = (await getResidentAccessModeFromContext(strapi, ctx)) ?? 'owner';

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.getSummary(Number(userId), accessMode);
    },

    async availableResidents(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar los residentes.');
      }

      const accessMode = (await getResidentAccessModeFromContext(strapi, ctx)) ?? 'owner';

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.listAvailableResidents(
        Number(userId),
        accessMode
      );
    },

    async submit(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para registrar poderes.');
      }

      const accessMode = (await getResidentAccessModeFromContext(strapi, ctx)) ?? 'owner';
      const payload = ctx.request.body?.payload ?? ctx.request.body;
      const files = ctx.request.files?.proofs ?? ctx.request.files?.proof ?? ctx.request.files;

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.submitDeclarations(
        Number(userId),
        accessMode,
        payload,
        files
      );
    },

    async lock(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para confirmar tu participacion.');
      }

      const accessMode = (await getResidentAccessModeFromContext(strapi, ctx)) ?? 'owner';

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.lockRepresentation(Number(userId), accessMode);
    },

    async remove(ctx: Context) {
      const userId = ctx.state.user?.id;
      const declarationId = Number(ctx.params.id);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para remover poderes.');
      }

      const accessMode = (await getResidentAccessModeFromContext(strapi, ctx)) ?? 'owner';

      if (!Number.isInteger(declarationId) || declarationId <= 0) {
        return ctx.badRequest('Debes indicar un poder valido.');
      }

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.removeDeclaration(
        Number(userId),
        accessMode,
        declarationId
      );
    },

    async adminByAssembly(ctx: Context) {
      const userId = ctx.state.user?.id;
      const assemblyId = Number(ctx.params.assemblyId);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar los poderes de la asamblea.');
      }

      if (!Number.isInteger(assemblyId) || assemblyId <= 0) {
        return ctx.badRequest('Debes indicar una asamblea valida.');
      }

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.listByAssembly(
        Number(userId),
        assemblyId
      );
    },

    async adminRevoke(ctx: Context) {
      const userId = ctx.state.user?.id;
      const declarationId = Number(ctx.params.id);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para revocar poderes.');
      }

      if (!Number.isInteger(declarationId) || declarationId <= 0) {
        return ctx.badRequest('Debes indicar un poder valido.');
      }

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.revokeDeclaration(
        Number(userId),
        declarationId,
        ctx.request.body?.reason
      );
    },
  })
);
