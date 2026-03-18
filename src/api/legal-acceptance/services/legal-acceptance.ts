import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getCurrentResidentLegalDocument,
  RESIDENT_ACCESS_LEGAL_KEY,
  type ResidentLegalDocument,
} from '../../../utils/resident-legal';
import {
  isAdminRole,
  normalizeResidentName,
  normalizeResidentUnit,
  type ResidentRoleEntity,
  type ResidentUserEntity,
} from '../../../utils/resident-session';

type LegalAcceptanceContext = 'resident_login';

type LegalAcceptanceEntity = {
  accepted_at?: string | null;
  context?: LegalAcceptanceContext | null;
  document_hash?: string | null;
  document_key?: string | null;
  document_version?: string | null;
  id: number;
  ip_address?: string | null;
  user?: ResidentUserEntity | null;
  user_agent?: string | null;
};

type LegalAcceptanceUser = ResidentUserEntity & {
  role?: ResidentRoleEntity | null;
};

type AcceptanceStatus = {
  acceptedAt: string | null;
  acceptedVersion: string | null;
  currentVersion: string;
  requiresAcceptance: boolean;
};

type AcceptanceListFilters = {
  dateFrom?: unknown;
  dateTo?: unknown;
  unit?: unknown;
  version?: unknown;
};

const ACCEPTANCE_CONTEXT: LegalAcceptanceContext = 'resident_login';
const { ForbiddenError, NotFoundError } = errors;

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeDateInput = (value: unknown) => {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  const parsedDate = new Date(normalizedValue);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const getAcceptedTimestamp = (value?: string | null) => {
  if (!value) {
    return 0;
  }

  const parsedDate = new Date(value);

  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
};

const serializeAcceptanceStatus = (
  document: ResidentLegalDocument,
  acceptance?: LegalAcceptanceEntity | null
): AcceptanceStatus => ({
  acceptedAt: acceptance?.accepted_at ?? null,
  acceptedVersion: acceptance?.document_version ?? null,
  currentVersion: document.version,
  requiresAcceptance: !acceptance || acceptance.document_version !== document.version,
});

export default factories.createCoreService(
  'api::legal-acceptance.legal-acceptance' as any,
  ({ strapi }) => {
    const getAcceptanceStatusForUser = async (userId: number) => {
      const document = getCurrentResidentLegalDocument();

      if (!Number.isInteger(userId) || userId <= 0) {
        return serializeAcceptanceStatus(document, null);
      }

      const acceptances = (await strapi.db
        .query('api::legal-acceptance.legal-acceptance')
        .findMany({
          limit: 1,
          orderBy: [{ accepted_at: 'desc' }, { id: 'desc' }],
          where: {
            context: ACCEPTANCE_CONTEXT,
            document_key: RESIDENT_ACCESS_LEGAL_KEY,
            document_version: document.version,
            user: userId,
          },
        })) as LegalAcceptanceEntity[];

      return serializeAcceptanceStatus(document, acceptances[0] ?? null);
    };

    return {
      getCurrentLegalDocument() {
        return getCurrentResidentLegalDocument();
      },

      async getAcceptanceStatusForUser(userId: number) {
        return getAcceptanceStatusForUser(userId);
      },

      async getAcceptanceStatusByUnit(unit: unknown) {
        const document = getCurrentResidentLegalDocument();
        const normalizedUnit = normalizeResidentUnit(unit);

        if (!normalizedUnit) {
          return serializeAcceptanceStatus(document, null);
        }

        const user = (await strapi.db.query('plugin::users-permissions.user').findOne({
          populate: {
            role: {
              fields: ['id', 'name', 'type'],
            },
          },
          where: {
            provider: 'local',
            $or: [{ UnidadPrivada: normalizedUnit }, { username: normalizedUnit }],
          },
        })) as LegalAcceptanceUser | null;

        if (!user || isAdminRole(user.role)) {
          return serializeAcceptanceStatus(document, null);
        }

        return getAcceptanceStatusForUser(user.id);
      },

      async registerCurrentVersionAcceptance(
        userId: number,
        payload: {
          context?: LegalAcceptanceContext;
          ipAddress?: unknown;
          userAgent?: unknown;
        }
      ) {
        const document = getCurrentResidentLegalDocument();
        const currentStatus = await getAcceptanceStatusForUser(userId);

        if (!currentStatus.requiresAcceptance) {
          return currentStatus;
        }

        const acceptedAt = new Date().toISOString();
        const normalizedIpAddress = normalizeText(payload.ipAddress).slice(0, 120) || null;
        const normalizedUserAgent = normalizeText(payload.userAgent).slice(0, 1000) || null;

        await strapi.entityService.create('api::legal-acceptance.legal-acceptance' as any, {
          data: {
            accepted_at: acceptedAt,
            context: payload.context ?? ACCEPTANCE_CONTEXT,
            document_hash: document.contentHash,
            document_key: document.documentKey,
            document_version: document.version,
            ip_address: normalizedIpAddress,
            user: userId,
            user_agent: normalizedUserAgent,
          },
        });

        return {
          acceptedAt,
          acceptedVersion: document.version,
          currentVersion: document.version,
          requiresAcceptance: false,
        };
      },

      async listAdminAcceptances(adminUserId: number, filters: AcceptanceListFilters) {
        const adminUser = (await strapi.db.query('plugin::users-permissions.user').findOne({
          populate: {
            role: {
              fields: ['id', 'name', 'type'],
            },
          },
          where: {
            id: adminUserId,
          },
        })) as LegalAcceptanceUser | null;

        if (!adminUser) {
          throw new NotFoundError('No se encontro el usuario administrador.');
        }

        if (!isAdminRole(adminUser.role)) {
          throw new ForbiddenError(
            'Solo un administrador puede consultar las aceptaciones legales.'
          );
        }

        const currentDocument = getCurrentResidentLegalDocument();
        const normalizedUnitFilter = normalizeResidentUnit(filters.unit);
        const normalizedVersionFilter = normalizeText(filters.version);
        const dateFrom = normalizeDateInput(filters.dateFrom);
        const dateTo = normalizeDateInput(filters.dateTo);

        const acceptances = (await strapi.db
          .query('api::legal-acceptance.legal-acceptance')
          .findMany({
            orderBy: [{ accepted_at: 'desc' }, { id: 'desc' }],
            populate: {
              user: {
                fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
                populate: {
                  role: {
                    fields: ['id', 'name', 'type'],
                  },
                },
              },
            },
            where: {
              context: ACCEPTANCE_CONTEXT,
              document_key: RESIDENT_ACCESS_LEGAL_KEY,
            },
          })) as LegalAcceptanceEntity[];

        const residentAcceptances = acceptances.filter(
          (acceptance) => acceptance.user && !isAdminRole(acceptance.user.role)
        );

        const filteredAcceptances = residentAcceptances.filter((acceptance) => {
          const residentUnit = normalizeResidentUnit(
            acceptance.user?.UnidadPrivada ?? acceptance.user?.username ?? ''
          );
          const acceptedTimestamp = getAcceptedTimestamp(acceptance.accepted_at);

          if (
            normalizedVersionFilter &&
            normalizeText(acceptance.document_version) !== normalizedVersionFilter
          ) {
            return false;
          }

          if (normalizedUnitFilter && !residentUnit.includes(normalizedUnitFilter)) {
            return false;
          }

          if (dateFrom && acceptedTimestamp < dateFrom.getTime()) {
            return false;
          }

          if (dateTo && acceptedTimestamp > dateTo.getTime()) {
            return false;
          }

          return true;
        });

        const currentVersionAcceptedUserIds = new Set(
          residentAcceptances
            .filter((acceptance) => acceptance.document_version === currentDocument.version)
            .map((acceptance) => acceptance.user?.id)
            .filter((value): value is number => Number.isInteger(value))
        );

        const residentUsers = (await strapi.entityService.findMany(
          'plugin::users-permissions.user',
          {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
            limit: 1000,
            populate: {
              role: {
                fields: ['id', 'name', 'type'],
              },
            },
          }
        )) as LegalAcceptanceUser[];

        const totalResidents = residentUsers.filter((user) => !isAdminRole(user.role)).length;
        const versions = Array.from(
          new Set([
            currentDocument.version,
            ...residentAcceptances
              .map((acceptance) => normalizeText(acceptance.document_version))
              .filter(Boolean),
          ])
        ).sort((left, right) => right.localeCompare(left));

        return {
          items: filteredAcceptances.map((acceptance) => ({
            acceptedAt: acceptance.accepted_at ?? null,
            documentHash: acceptance.document_hash ?? null,
            documentVersion: acceptance.document_version ?? null,
            id: acceptance.id,
            ipAddress: acceptance.ip_address ?? null,
            name: normalizeResidentName(acceptance.user),
            unit: normalizeResidentUnit(
              acceptance.user?.UnidadPrivada ?? acceptance.user?.username ?? ''
            ),
            userAgent: acceptance.user_agent ?? null,
          })),
          summary: {
            currentAcceptedCount: currentVersionAcceptedUserIds.size,
            currentUpdatedAt: currentDocument.updatedAt,
            currentVersion: currentDocument.version,
            totalRecords: filteredAcceptances.length,
            totalResidents,
            versions,
          },
        };
      },
    };
  }
);
