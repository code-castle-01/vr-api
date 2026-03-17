import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ForbiddenError, NotFoundError, ValidationError } = errors;

type RoleEntity = {
  name?: string | null;
  type?: string | null;
};

type UserEntity = {
  id: number;
  NombreCompleto?: string | null;
  UnidadPrivada?: string | null;
  email?: string | null;
  role?: RoleEntity | null;
};

type UploadedFileEntity = {
  ext?: string | null;
  id: number;
  mime?: string | null;
  name?: string | null;
  size?: number | null;
  url?: string | null;
};

type MeetingDocumentEntity = {
  createdAt?: string | null;
  file?: UploadedFileEntity | null;
  id: number;
  title?: string | null;
  updatedAt?: string | null;
  uploaded_by?: UserEntity | null;
};

type UploadFileInput = {
  mimetype?: string;
  name?: string;
  path?: string;
  size?: number;
  type?: string;
};

type UploadService = {
  upload: (
    input: {
      data?: Record<string, unknown>;
      files: UploadFileInput | UploadFileInput[];
    }
  ) => Promise<Array<UploadedFileEntity>>;
};

const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'text/csv',
]);

const isAdminRole = (role?: RoleEntity | null) => {
  const normalizedName = role?.name?.trim().toLowerCase();
  const normalizedType = role?.type?.trim().toLowerCase();

  if (normalizedName === 'admin' || normalizedName === 'administrador') {
    return true;
  }

  return Boolean(normalizedType && normalizedType !== 'authenticated' && normalizedType !== 'public');
};

const normalizeName = (user?: UserEntity | null) =>
  user?.NombreCompleto ?? user?.UnidadPrivada ?? user?.email ?? `Usuario ${user?.id ?? ''}`;

const normalizeSingleFile = (file: unknown): UploadFileInput | null => {
  if (Array.isArray(file)) {
    return (file[0] as UploadFileInput | undefined) ?? null;
  }

  return (file as UploadFileInput | null) ?? null;
};

const serializeDocument = (document: MeetingDocumentEntity) => ({
  createdAt: document.createdAt ?? null,
  file: document.file
    ? {
        ext: document.file.ext ?? null,
        id: document.file.id,
        mime: document.file.mime ?? null,
        name: document.file.name ?? null,
        size: Number(document.file.size ?? 0),
        url: document.file.url ?? null,
      }
    : null,
  id: document.id,
  title: document.title ?? `Documento ${document.id}`,
  updatedAt: document.updatedAt ?? null,
  uploadedBy: document.uploaded_by
    ? {
        id: document.uploaded_by.id,
        name: normalizeName(document.uploaded_by),
        unit: document.uploaded_by.UnidadPrivada ?? null,
      }
    : null,
});

export default factories.createCoreService(
  'api::meeting-document.meeting-document',
  ({ strapi }) => {
    const ensureAdminUser = async (userId: number) => {
      const user = (await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'email'],
        populate: {
          role: {
            fields: ['name', 'type'],
          },
        },
      })) as UserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el usuario autenticado.');
      }

      if (!isAdminRole(user.role)) {
        throw new ForbiddenError('Solo un administrador puede gestionar documentos.');
      }

      return user;
    };

    const validateTitle = (title: unknown, required: boolean) => {
      if (typeof title !== 'string') {
        if (required) {
          throw new ValidationError('Debes indicar el titulo del documento.');
        }

        return undefined;
      }

      const normalizedTitle = title.trim();

      if (!normalizedTitle && required) {
        throw new ValidationError('Debes indicar el titulo del documento.');
      }

      return normalizedTitle || undefined;
    };

    const validateFile = (file: UploadFileInput | null, required: boolean) => {
      if (!file) {
        if (required) {
          throw new ValidationError('Debes cargar un archivo para continuar.');
        }

        return null;
      }

      const mimeType = file.mimetype ?? file.type ?? '';

      if (!ALLOWED_FILE_TYPES.has(mimeType)) {
        throw new ValidationError(
          'Solo se permiten archivos PDF, Word, Excel, PowerPoint, CSV o imagenes.'
        );
      }

      return file;
    };

    const uploadFile = async (file: UploadFileInput, title: string) => {
      const uploadService = strapi.plugin('upload').service('upload') as unknown as UploadService;
      const uploadedFiles = await uploadService.upload({
        data: {
          fileInfo: {
            alternativeText: title,
            caption: title,
            name: file.name ?? title,
          },
        },
        files: file,
      });

      const uploadedFile = uploadedFiles[0];

      if (!uploadedFile?.id) {
        throw new ValidationError('No fue posible almacenar el archivo cargado.');
      }

      return uploadedFile;
    };

    const removeUploadFile = async (fileId?: number | null) => {
      if (!fileId) {
        return;
      }

      try {
        await strapi.entityService.delete('plugin::upload.file', fileId);
      } catch (error) {
        strapi.log.warn(
          `No se pudo eliminar el archivo adjunto ${fileId}: ${
            error instanceof Error ? error.message : 'Error desconocido'
          }`
        );
      }
    };

    const getDocumentOrThrow = async (documentId: number) => {
      const document = (await strapi.entityService.findOne(
        'api::meeting-document.meeting-document',
        documentId,
        {
          fields: ['id', 'title', 'createdAt', 'updatedAt'],
          populate: {
            file: {
              fields: ['id', 'name', 'url', 'mime', 'ext', 'size'],
            },
            uploaded_by: {
              fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'email'],
            },
          },
        }
      )) as MeetingDocumentEntity | null;

      if (!document) {
        throw new NotFoundError('No se encontro el documento solicitado.');
      }

      return document;
    };

    return {
      async listLibraryDocuments() {
        const documents = (await strapi.entityService.findMany('api::meeting-document.meeting-document', {
          fields: ['id', 'title', 'createdAt', 'updatedAt'],
          populate: {
            file: {
              fields: ['id', 'name', 'url', 'mime', 'ext', 'size'],
            },
            uploaded_by: {
              fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'email'],
            },
          },
          sort: {
            updatedAt: 'desc',
          },
        })) as MeetingDocumentEntity[];

        return {
          items: documents.map(serializeDocument),
          total: documents.length,
        };
      },

      async getLibraryDocument(documentId: number) {
        const document = await getDocumentOrThrow(documentId);

        return serializeDocument(document);
      },

      async listAdminDocuments(userId: number) {
        await ensureAdminUser(userId);
        return this.listLibraryDocuments();
      },

      async getAdminDocument(userId: number, documentId: number) {
        await ensureAdminUser(userId);
        return this.getLibraryDocument(documentId);
      },

      async createAdminDocument(userId: number, title: unknown, file: unknown) {
        await ensureAdminUser(userId);

        const normalizedTitle = validateTitle(title, true) as string;
        const normalizedFile = validateFile(normalizeSingleFile(file), true) as UploadFileInput;
        const uploadedFile = await uploadFile(normalizedFile, normalizedTitle);

        const document = (await strapi.entityService.create('api::meeting-document.meeting-document', {
          data: {
            file: uploadedFile.id,
            title: normalizedTitle,
            uploaded_by: userId,
          },
          populate: {
            file: {
              fields: ['id', 'name', 'url', 'mime', 'ext', 'size'],
            },
            uploaded_by: {
              fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'email'],
            },
          },
        })) as MeetingDocumentEntity;

        return serializeDocument(document);
      },

      async updateAdminDocument(userId: number, documentId: number, title: unknown, file: unknown) {
        await ensureAdminUser(userId);

        const existingDocument = await getDocumentOrThrow(documentId);
        const normalizedTitle = validateTitle(title, false) ?? existingDocument.title ?? `Documento ${documentId}`;
        const normalizedFile = validateFile(normalizeSingleFile(file), false);

        let uploadedFileId = existingDocument.file?.id;

        if (normalizedFile) {
          const uploadedFile = await uploadFile(normalizedFile, normalizedTitle);
          uploadedFileId = uploadedFile.id;
        }

        const updatedDocument = (await strapi.entityService.update(
          'api::meeting-document.meeting-document',
          documentId,
          {
            data: {
              file: uploadedFileId,
              title: normalizedTitle,
              uploaded_by: userId,
            },
            populate: {
              file: {
                fields: ['id', 'name', 'url', 'mime', 'ext', 'size'],
              },
              uploaded_by: {
                fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'email'],
              },
            },
          }
        )) as MeetingDocumentEntity;

        if (normalizedFile && existingDocument.file?.id && existingDocument.file.id !== uploadedFileId) {
          await removeUploadFile(existingDocument.file.id);
        }

        return serializeDocument(updatedDocument);
      },

      async deleteAdminDocument(userId: number, documentId: number) {
        await ensureAdminUser(userId);

        const existingDocument = await getDocumentOrThrow(documentId);

        await strapi.entityService.delete('api::meeting-document.meeting-document', documentId);
        await removeUploadFile(existingDocument.file?.id);

        return {
          id: documentId,
          removed: true,
        };
      },
    };
  }
);
