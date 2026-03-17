import { factories } from '@strapi/strapi';
import type { Context } from 'koa';

type MeetingDocumentService = {
  createAdminDocument: (userId: number, title: unknown, file: unknown) => Promise<unknown>;
  deleteAdminDocument: (userId: number, documentId: number) => Promise<unknown>;
  getAdminDocument: (userId: number, documentId: number) => Promise<unknown>;
  getLibraryDocument: (documentId: number) => Promise<unknown>;
  listAdminDocuments: (userId: number) => Promise<unknown>;
  listLibraryDocuments: () => Promise<unknown>;
  updateAdminDocument: (
    userId: number,
    documentId: number,
    title: unknown,
    file: unknown
  ) => Promise<unknown>;
};

export default factories.createCoreController(
  'api::meeting-document.meeting-document',
  ({ strapi }) => ({
    async library(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar los documentos.');
      }

      const meetingDocumentService = strapi.service(
        'api::meeting-document.meeting-document'
      ) as unknown as MeetingDocumentService;

      ctx.body = await meetingDocumentService.listLibraryDocuments();
    },

    async libraryOne(ctx: Context) {
      const userId = ctx.state.user?.id;
      const documentId = Number(ctx.params.id);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar el documento.');
      }

      if (!Number.isInteger(documentId) || documentId <= 0) {
        return ctx.badRequest('Debes indicar un documento valido.');
      }

      const meetingDocumentService = strapi.service(
        'api::meeting-document.meeting-document'
      ) as unknown as MeetingDocumentService;

      ctx.body = await meetingDocumentService.getLibraryDocument(documentId);
    },

    async adminList(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar los documentos administrativos.');
      }

      const meetingDocumentService = strapi.service(
        'api::meeting-document.meeting-document'
      ) as unknown as MeetingDocumentService;

      ctx.body = await meetingDocumentService.listAdminDocuments(Number(userId));
    },

    async adminOne(ctx: Context) {
      const userId = ctx.state.user?.id;
      const documentId = Number(ctx.params.id);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para consultar el documento administrativo.');
      }

      if (!Number.isInteger(documentId) || documentId <= 0) {
        return ctx.badRequest('Debes indicar un documento valido.');
      }

      const meetingDocumentService = strapi.service(
        'api::meeting-document.meeting-document'
      ) as unknown as MeetingDocumentService;

      ctx.body = await meetingDocumentService.getAdminDocument(Number(userId), documentId);
    },

    async adminCreate(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para cargar documentos.');
      }

      const title = ctx.request.body?.title;
      const file = ctx.request.files?.file ?? ctx.request.files?.attachment ?? ctx.request.files;
      const meetingDocumentService = strapi.service(
        'api::meeting-document.meeting-document'
      ) as unknown as MeetingDocumentService;

      ctx.body = await meetingDocumentService.createAdminDocument(Number(userId), title, file);
    },

    async adminUpdate(ctx: Context) {
      const userId = ctx.state.user?.id;
      const documentId = Number(ctx.params.id);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para editar documentos.');
      }

      if (!Number.isInteger(documentId) || documentId <= 0) {
        return ctx.badRequest('Debes indicar un documento valido.');
      }

      const title = ctx.request.body?.title;
      const file = ctx.request.files?.file ?? ctx.request.files?.attachment ?? ctx.request.files;
      const meetingDocumentService = strapi.service(
        'api::meeting-document.meeting-document'
      ) as unknown as MeetingDocumentService;

      ctx.body = await meetingDocumentService.updateAdminDocument(
        Number(userId),
        documentId,
        title,
        file
      );
    },

    async adminDelete(ctx: Context) {
      const userId = ctx.state.user?.id;
      const documentId = Number(ctx.params.id);

      if (!userId) {
        return ctx.unauthorized('Debes iniciar sesion para borrar documentos.');
      }

      if (!Number.isInteger(documentId) || documentId <= 0) {
        return ctx.badRequest('Debes indicar un documento valido.');
      }

      const meetingDocumentService = strapi.service(
        'api::meeting-document.meeting-document'
      ) as unknown as MeetingDocumentService;

      ctx.body = await meetingDocumentService.deleteAdminDocument(Number(userId), documentId);
    },
  })
);
