export default {
  routes: [
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
