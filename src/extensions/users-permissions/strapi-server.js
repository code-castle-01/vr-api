'use strict';

const isRoleMissing = (value) => {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (typeof value === 'number') {
    return !Number.isFinite(value) || value <= 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    if ('id' in value) {
      return isRoleMissing(value.id);
    }

    if ('connect' in value) {
      const connectValue = value.connect;

      if (Array.isArray(connectValue)) {
        return connectValue.length === 0;
      }

      return isRoleMissing(connectValue);
    }
  }

  return false;
};

const findDefaultRoleId = async () => {
  const advanced = await strapi.store({ type: 'plugin', name: 'users-permissions', key: 'advanced' }).get();
  const configuredRoleType = advanced?.default_role || 'authenticated';

  const defaultRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: configuredRoleType } });

  if (defaultRole?.id) {
    return defaultRole.id;
  }

  const authenticatedRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });

  return authenticatedRole?.id;
};

const withDefaultRole = (originalCreate) => {
  return async (ctx) => {
    ctx.request.body = ctx.request.body ?? {};

    if (isRoleMissing(ctx.request.body.role)) {
      const defaultRoleId = await findDefaultRoleId();

      if (defaultRoleId) {
        ctx.request.body.role = defaultRoleId;
      }
    }

    return originalCreate(ctx);
  };
};

module.exports = (plugin) => {
  if (plugin.controllers?.user?.create) {
    plugin.controllers.user.create = withDefaultRole(plugin.controllers.user.create);
  }

  if (plugin.controllers?.contentmanageruser?.create) {
    plugin.controllers.contentmanageruser.create = withDefaultRole(
      plugin.controllers.contentmanageruser.create
    );
  }

  return plugin;
};
