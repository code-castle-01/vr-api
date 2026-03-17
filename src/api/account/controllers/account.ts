import type { Context } from 'koa';

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

export default {
  async me(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para consultar tu cuenta.');
    }

    const user = await strapi.entityService.findOne('plugin::users-permissions.user', Number(userId), {
      fields: ACCOUNT_FIELDS,
      populate: ACCOUNT_POPULATE,
    });

    ctx.body = user;
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
};
