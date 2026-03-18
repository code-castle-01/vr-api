export default {
  routes: [
    {
      method: 'GET',
      path: '/legal-acceptances/admin',
      handler: 'legal-acceptance.adminList',
      config: {
        policies: [],
      },
    },
  ],
};
