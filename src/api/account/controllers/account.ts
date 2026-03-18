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

export default {
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

    ctx.body = user ? { ...user, residentAccessMode } : { residentAccessMode };
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
    const { residentAccessMode, unit } = (ctx.request.body ?? {}) as ResidentLoginBody;
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
      residentAccessMode: normalizedAccessMode,
      user: account,
    };
  },
};
