export default {
  routes: [
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
