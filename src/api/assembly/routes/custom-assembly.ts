export default {
  routes: [
    {
      method: 'GET',
      path: '/assemblies/:id/exhaustive-report',
      handler: 'assembly.adminExhaustiveReport',
      config: {
        policies: [],
      },
    },
  ],
};
