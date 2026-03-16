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
  ],
};
