import { factories } from '@strapi/strapi';
import type { Context } from 'koa';

type ProxyAuthorizationService = {
  getSummary: (userId: number) => Promise<unknown>;
  listAvailableResidents: (userId: number) => Promise<unknown>;
  listByAssembly: (userId: number, assemblyId: number) => Promise<unknown>;
  removeDeclaration: (userId: number, declarationId: number) => Promise<unknown>;
  submitDeclarations: (userId: number, payload: unknown, files: unknown) => Promise<unknown>;
};

export default factories.createCoreController(
  'api::proxy-authorization.proxy-authorization',
  ({ strapi }) => ({
    async mine(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar tus poderes.');
      }

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.getSummary(Number(userId));
    },

    async availableResidents(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar los residentes.');
      }

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.listAvailableResidents(Number(userId));
    },

    async submit(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para registrar poderes.');
      }

      const payload = ctx.request.body?.payload ?? ctx.request.body;
      const files = ctx.request.files?.proofs ?? ctx.request.files?.proof ?? ctx.request.files;

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.submitDeclarations(
        Number(userId),
        payload,
        files
      );
    },

    async remove(ctx: Context) {
      const userId = ctx.state.user?.id;
      const declarationId = Number(ctx.params.id);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para remover poderes.');
      }

      if (!Number.isInteger(declarationId) || declarationId <= 0) {
        return ctx.badRequest('Debes indicar un poder valido.');
      }

      const proxyAuthorizationService = strapi.service(
        'api::proxy-authorization.proxy-authorization'
      ) as unknown as ProxyAuthorizationService;

      ctx.body = await proxyAuthorizationService.removeDeclaration(
        Number(userId),
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
  })
);
