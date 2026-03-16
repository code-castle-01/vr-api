import type { Context } from 'koa';

export default {
  async me(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para consultar tu cuenta.');
    }

    const user = await strapi.entityService.findOne('plugin::users-permissions.user', Number(userId), {
      fields: [
        'id',
        'username',
        'email',
        'NombreCompleto',
        'UnidadPrivada',
        'Coeficiente',
        'EstadoCartera',
        'blocked',
      ],
      populate: {
        role: {
          fields: ['id', 'name', 'type'],
        },
      },
    });

    ctx.body = user;
  },
};
