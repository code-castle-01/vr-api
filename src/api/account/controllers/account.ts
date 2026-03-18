import type { Context } from 'koa';
const bcrypt = require('bcryptjs');
import {
  buildLegacyResidentPassword,
  buildResidentPassword,
  findCurrentAssembly,
  getJwtService,
  getResidentAccessModeFromContext,
  isAdminRole,
  normalizeResidentAccessMode,
  normalizeResidentUnit,
  upsertResidentAttendance,
} from '../../../utils/resident-session';
import { RESIDENT_ACCESS_LEGAL_KEY } from '../../../utils/resident-legal';

const ACCOUNT_FIELDS: Array<
  | 'id'
  | 'username'
  | 'email'
  | 'NombreCompleto'
  | 'UnidadPrivada'
  | 'Coeficiente'
  | 'EstadoCartera'
  | 'blocked'
> = [
  'id',
  'username',
  'email',
  'NombreCompleto',
  'UnidadPrivada',
  'Coeficiente',
  'EstadoCartera',
  'blocked',
];

const ACCOUNT_POPULATE = {
  role: {
    fields: ['id', 'name', 'type'] as Array<'id' | 'name' | 'type'>,
  },
};

type ResidentLoginBody = {
  legalAccepted?: boolean;
  legalVersion?: string;
  residentAccessMode?: string;
  unit?: string;
};

type LoginResidentUser = {
  blocked?: boolean | null;
  confirmed?: boolean | null;
  email?: string | null;
  id: number;
  password?: string | null;
  role?: {
    id?: number;
    name?: string | null;
    type?: string | null;
  } | null;
  username?: string | null;
  UnidadPrivada?: string | null;
};

const PASSWORD_HASH_ROUNDS = 10;
const isHashedPassword = (value: unknown): value is string =>
  typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
const normalizeHeaderValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : '';
  }

  return typeof value === 'string' ? value.trim() : '';
};
const getClientIpAddress = (ctx: Context) => {
  const forwardedFor = normalizeHeaderValue(ctx.request.headers['x-forwarded-for']);

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() ?? forwardedFor;
  }

  return ctx.request.ip ?? '';
};

type LegalAcceptanceService = {
  getAcceptanceStatusByUnit: (unit: unknown) => Promise<{
    acceptedAt: string | null;
    acceptedVersion: string | null;
    currentVersion: string;
    requiresAcceptance: boolean;
  }>;
  getAcceptanceStatusForUser: (userId: number) => Promise<{
    acceptedAt: string | null;
    acceptedVersion: string | null;
    currentVersion: string;
    requiresAcceptance: boolean;
  }>;
  getCurrentLegalDocument: () => {
    checkboxLabel: string;
    contentHash: string;
    documentKey: string;
    sections: Array<{
      bullets?: string[];
      id: string;
      paragraphs: string[];
      title: string;
    }>;
    summary: string;
    title: string;
    updatedAt: string;
    version: string;
  };
  registerCurrentVersionAcceptance: (
    userId: number,
    payload: {
      context?: 'resident_login';
      ipAddress?: unknown;
      userAgent?: unknown;
    }
  ) => Promise<{
    acceptedAt: string | null;
    acceptedVersion: string | null;
    currentVersion: string;
    requiresAcceptance: boolean;
  }>;
};

export default {
  async residentLegal(ctx: Context) {
    const legalAcceptanceService = strapi.service(
      'api::legal-acceptance.legal-acceptance'
    ) as unknown as LegalAcceptanceService;
    const document = legalAcceptanceService.getCurrentLegalDocument();

    ctx.body = {
      checkboxLabel: document.checkboxLabel,
      contentHash: document.contentHash,
      documentKey: document.documentKey,
      sections: document.sections,
      summary: document.summary,
      title: document.title,
      updatedAt: document.updatedAt,
      version: document.version,
    };
  },

  async residentLegalStatus(ctx: Context) {
    const legalAcceptanceService = strapi.service(
      'api::legal-acceptance.legal-acceptance'
    ) as unknown as LegalAcceptanceService;

    ctx.body = await legalAcceptanceService.getAcceptanceStatusByUnit(ctx.query?.unit);
  },

  async me(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para consultar tu cuenta.');
    }

    const user = (await strapi.entityService.findOne(
      'plugin::users-permissions.user',
      Number(userId),
      {
        fields: ACCOUNT_FIELDS,
        populate: ACCOUNT_POPULATE,
      }
    )) as Record<string, unknown> | null;

    const residentAccessMode = await getResidentAccessModeFromContext(strapi, ctx);
    const legalAcceptanceService = strapi.service(
      'api::legal-acceptance.legal-acceptance'
    ) as unknown as LegalAcceptanceService;
    const residentLegalAcceptance =
      user && !isAdminRole((user.role as LoginResidentUser['role']) ?? null)
        ? await legalAcceptanceService.getAcceptanceStatusForUser(Number(userId))
        : null;

    ctx.body = user
      ? { ...user, residentAccessMode, residentLegalAcceptance }
      : { residentAccessMode, residentLegalAcceptance };
  },

  async updateMe(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para actualizar tu cuenta.');
    }

    const nextName =
      ctx.request.body?.NombreCompleto ??
      ctx.request.body?.nombreCompleto ??
      ctx.request.body?.name;

    if (typeof nextName !== 'string') {
      return ctx.badRequest('Debes indicar el nombre que deseas guardar.');
    }

    const normalizedName = nextName.trim().replace(/\s+/g, ' ');

    if (!normalizedName) {
      return ctx.badRequest('El nombre no puede quedar vacio.');
    }

    if (normalizedName.length > 140) {
      return ctx.badRequest('El nombre no puede superar los 140 caracteres.');
    }

    const updatedUser = await strapi.entityService.update(
      'plugin::users-permissions.user',
      Number(userId),
      {
        data: {
          NombreCompleto: normalizedName,
        },
        fields: ACCOUNT_FIELDS,
        populate: ACCOUNT_POPULATE,
      }
    );

    ctx.body = updatedUser;
  },

  async residentLogin(ctx: Context) {
    const { legalAccepted, legalVersion, residentAccessMode, unit } = (ctx.request.body ??
      {}) as ResidentLoginBody;
    const normalizedUnit = normalizeResidentUnit(unit ?? '');
    const normalizedAccessMode = normalizeResidentAccessMode(residentAccessMode);

    if (!normalizedUnit) {
      return ctx.badRequest('Debes indicar una unidad valida para iniciar sesion.');
    }

    if (!normalizedAccessMode) {
      return ctx.badRequest('Debes seleccionar si ingresas como propietario o apoderado.');
    }

    const user = (await strapi.query('plugin::users-permissions.user').findOne({
      populate: ['role'],
      where: {
        provider: 'local',
        $or: [{ UnidadPrivada: normalizedUnit }, { username: normalizedUnit }],
      },
    })) as LoginResidentUser | null;

    if (!user || !user.password) {
      return ctx.badRequest('No encontramos una cuenta residente asociada a esa unidad.');
    }

    if (isAdminRole(user.role)) {
      return ctx.badRequest('Esta unidad no puede usar el acceso residente.');
    }

    if (user.confirmed === false) {
      return ctx.badRequest('La cuenta de esta unidad no esta confirmada.');
    }

    if (user.blocked) {
      return ctx.forbidden('La cuenta de esta unidad fue bloqueada por un administrador.');
    }

    const userService = strapi.plugin('users-permissions').service('user') as {
      validatePassword: (password: string, hash: string) => Promise<boolean>;
    };
    const passwordCandidates = [
      buildResidentPassword(normalizedUnit),
      buildLegacyResidentPassword(normalizedUnit),
    ];
    let passwordMatches = false;
    let passwordNeedsUpgrade = false;

    for (const passwordCandidate of passwordCandidates) {
      if (user.password === passwordCandidate) {
        passwordMatches = true;
        passwordNeedsUpgrade = true;
        break;
      }

      if (!isHashedPassword(user.password)) {
        continue;
      }

      if (await userService.validatePassword(passwordCandidate, user.password)) {
        passwordMatches = true;
        passwordNeedsUpgrade = passwordCandidate !== buildResidentPassword(normalizedUnit);
        break;
      }
    }

    if (!passwordMatches) {
      return ctx.badRequest('La cuenta residente no tiene una credencial valida para acceso sin contraseña.');
    }

    if (passwordNeedsUpgrade) {
      await strapi.entityService.update('plugin::users-permissions.user', user.id, {
        data: {
          password: await bcrypt.hash(buildResidentPassword(normalizedUnit), PASSWORD_HASH_ROUNDS),
        },
      });
    }

    const legalAcceptanceService = strapi.service(
      'api::legal-acceptance.legal-acceptance'
    ) as unknown as LegalAcceptanceService;
    const legalAcceptanceStatus = await legalAcceptanceService.getAcceptanceStatusForUser(user.id);

    if (legalAcceptanceStatus.requiresAcceptance) {
      if (legalAccepted !== true) {
        return ctx.badRequest(
          'Debes aceptar la Politica de Tratamiento de Datos Personales y los Terminos del portal antes de ingresar.'
        );
      }

      if (
        typeof legalVersion !== 'string' ||
        legalVersion.trim() !== legalAcceptanceStatus.currentVersion
      ) {
        return ctx.badRequest(
          'La version legal vigente cambio o no fue enviada correctamente. Actualiza la pagina e intenta de nuevo.'
        );
      }

      await legalAcceptanceService.registerCurrentVersionAcceptance(user.id, {
        context: 'resident_login',
        ipAddress: getClientIpAddress(ctx),
        userAgent: normalizeHeaderValue(ctx.request.headers['user-agent']),
      });
    }

    const jwt = getJwtService(strapi).issue({
      id: user.id,
      residentAccessMode: normalizedAccessMode,
    });
    const currentAssembly = await findCurrentAssembly(strapi);

    if (currentAssembly?.id) {
      await upsertResidentAttendance(strapi, {
        accessMode: normalizedAccessMode,
        assemblyId: currentAssembly.id,
        userId: user.id,
      });
    }

    const account = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
      fields: ACCOUNT_FIELDS,
      populate: ACCOUNT_POPULATE,
    });

    ctx.body = {
      jwt,
      legalDocumentKey: RESIDENT_ACCESS_LEGAL_KEY,
      residentAccessMode: normalizedAccessMode,
      user: account,
    };
  },
};
