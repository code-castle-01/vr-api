export default {
  routes: [
    {
      method: 'GET',
      path: '/agenda-items/results/:id',
      handler: 'agenda-item.results',
      config: {
        policies: [],
      },
    },
  ],
};
