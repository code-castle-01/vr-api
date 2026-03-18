export default {
  routes: [
    {
      method: 'GET',
      path: '/proxy-authorizations/mine',
      handler: 'proxy-authorization.mine',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/proxy-authorizations/available-residents',
      handler: 'proxy-authorization.availableResidents',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/proxy-authorizations/submit',
      handler: 'proxy-authorization.submit',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/proxy-authorizations/lock',
      handler: 'proxy-authorization.lock',
      config: {
        policies: [],
      },
    },
    {
      method: 'DELETE',
      path: '/proxy-authorizations/:id',
      handler: 'proxy-authorization.remove',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/proxy-authorizations/admin/assemblies/:assemblyId',
      handler: 'proxy-authorization.adminByAssembly',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/proxy-authorizations/admin/:id/revoke',
      handler: 'proxy-authorization.adminRevoke',
      config: {
        policies: [],
      },
    },
  ],
};
