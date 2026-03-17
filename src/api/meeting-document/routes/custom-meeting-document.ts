export default {
  routes: [
    {
      method: 'GET',
      path: '/meeting-documents/admin',
      handler: 'meeting-document.adminList',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/meeting-documents/admin/:id',
      handler: 'meeting-document.adminOne',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/meeting-documents/admin',
      handler: 'meeting-document.adminCreate',
      config: {
        policies: [],
      },
    },
    {
      method: 'PUT',
      path: '/meeting-documents/admin/:id',
      handler: 'meeting-document.adminUpdate',
      config: {
        policies: [],
      },
    },
    {
      method: 'DELETE',
      path: '/meeting-documents/admin/:id',
      handler: 'meeting-document.adminDelete',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/meeting-documents/library',
      handler: 'meeting-document.library',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/meeting-documents/library/:id',
      handler: 'meeting-document.libraryOne',
      config: {
        policies: [],
      },
    },
  ],
};
