export default {
  routes: [
    {
      method: 'GET',
      path: '/account/resident-access-config',
      handler: 'account.residentAccessConfig',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/account/admin-login',
      handler: 'account.adminLogin',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/account/admin/resident-access-config',
      handler: 'account.adminResidentAccessConfig',
      config: {
        policies: [],
      },
    },
    {
      method: 'PUT',
      path: '/account/admin/resident-access-config',
      handler: 'account.updateAdminResidentAccessConfig',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/account/resident-legal',
      handler: 'account.residentLegal',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/account/resident-legal-status',
      handler: 'account.residentLegalStatus',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/account/resident-login',
      handler: 'account.residentLogin',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/account/me',
      handler: 'account.me',
      config: {
        policies: [],
      },
    },
    {
      method: 'PATCH',
      path: '/account/me',
      handler: 'account.updateMe',
      config: {
        policies: [],
      },
    },
  ],
};
