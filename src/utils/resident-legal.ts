import { createHash } from 'crypto';

export const RESIDENT_ACCESS_LEGAL_KEY = 'resident-access-legal';

export type ResidentLegalSection = {
  bullets?: string[];
  id: string;
  paragraphs: string[];
  title: string;
};

export type ResidentLegalDocument = {
  checkboxLabel: string;
  contentHash: string;
  documentKey: string;
  sections: ResidentLegalSection[];
  summary: string;
  title: string;
  updatedAt: string;
  version: string;
};

type ResidentLegalDocumentSeed = Omit<ResidentLegalDocument, 'contentHash'>;

const RESIDENT_ACCESS_LEGAL_SEED: ResidentLegalDocumentSeed = {
  documentKey: RESIDENT_ACCESS_LEGAL_KEY,
  version: '2026.03.18',
  updatedAt: '2026-03-18T19:00:00-05:00',
  title: 'Politica de Tratamiento de Datos Personales y Terminos del Portal de Asamblea',
  checkboxLabel:
    'He leido y acepto la Politica de Tratamiento de Datos Personales y los Terminos y Condiciones del portal de la asamblea.',
  summary:
    'Este portal permite gestionar asistencia, poderes, documentos, votacion y resultados de la asamblea del Conjunto Cerrado Vegas del Rio P.H. Su uso exige aceptar las reglas operativas y el tratamiento de los datos necesarios para la administracion de la reunion.',
  sections: [
    {
      id: 'responsable',
      title: 'Responsable del tratamiento',
      paragraphs: [
        'El responsable del tratamiento de los datos personales tratados a traves del portal es el CONJUNTO CERRADO VEGAS DEL RIO P.H., a traves de su administracion.',
        'Para la asamblea ordinaria convocada el 02 de marzo de 2026 y programada para el 18 de marzo de 2026, la administracion actua a traves del administrador EDGAR HERNANDEZ.',
        'Canales de contacto: Avenida El Rio N. 25N-90, San Jose de Cucuta; telefonos 5747357 y 3153084105; correo electronico conjuntovegasdelrio@hotmail.com.',
      ],
    },
    {
      id: 'datos-tratados',
      title: 'Datos tratados por el portal',
      paragraphs: [
        'El portal puede tratar datos de identificacion y relacion con la copropiedad, tales como nombre completo, unidad privada, correo, estado de acceso al sistema y coeficiente de copropiedad.',
        'Adicionalmente puede tratar registros operativos de asistencia, modalidad de ingreso, poderes cargados, soportes documentales de representacion, votos emitidos y resultados asociados a la participacion en la asamblea.',
        'Cuando se acepte este documento se almacenaran datos de auditoria para soporte del cumplimiento, incluidos fecha y hora, direccion IP, navegador o dispositivo reportado y la version aceptada.',
      ],
    },
    {
      id: 'finalidades',
      title: 'Finalidades del tratamiento',
      paragraphs: [
        'Los datos personales se trataran con la finalidad de convocar, organizar, verificar quorum, administrar asistencia, validar representaciones, habilitar la votacion, publicar documentos y consolidar resultados de la asamblea general ordinaria de propietarios.',
        'Tambien se utilizaran para atender consultas, reclamos, trazabilidad operativa, seguridad del portal, control de poderes y cumplimiento de obligaciones legales y reglamentarias de la propiedad horizontal.',
      ],
    },
    {
      id: 'reglas-de-uso',
      title: 'Reglas de uso del portal y de los poderes',
      paragraphs: [
        'El residente debe ingresar con su unidad y seleccionar la modalidad de ingreso que corresponda. La informacion aportada debe ser veraz, completa y actualizada.',
        'El poder debe contar con soporte valido y suficiente. No se admiten poderes verbales, soportes sin firma del propietario o documentos con informacion inconsistente.',
        'El administrador puede denegar o revocar poderes que no cumplan los requisitos operativos o legales. Cuando esto ocurra, la unidad revocada deja de ser representada, recupera la posibilidad de representarse a si misma y puede volver a presentar un soporte correcto.',
      ],
      bullets: [
        'Se aceptan maximo 2 poderes por persona.',
        'La representacion queda sujeta a validacion administrativa.',
        'Una unidad con poder revocado queda libre para ser representada nuevamente.',
        'Los documentos cargados en el portal constituyen soporte de control interno de la asamblea.',
      ],
    },
    {
      id: 'derechos',
      title: 'Derechos del titular',
      paragraphs: [
        'El titular podra conocer, actualizar, rectificar y solicitar supresion de sus datos personales, asi como revocar la autorizacion cuando sea procedente y presentar consultas o reclamos sobre el tratamiento.',
        'La administracion dara tramite a estas solicitudes a traves de los canales oficiales informados en este documento, de conformidad con la normativa colombiana aplicable.',
      ],
    },
    {
      id: 'consultas-reclamos',
      title: 'Canales de consultas y reclamos',
      paragraphs: [
        'Las consultas, solicitudes de actualizacion, rectificacion, supresion o reclamos relacionados con el tratamiento de datos y el uso del portal podran presentarse al correo conjuntovegasdelrio@hotmail.com o en la administracion del conjunto en la direccion antes indicada.',
        'La administracion podra solicitar informacion adicional para validar la identidad del solicitante antes de tramitar cualquier peticion.',
      ],
    },
    {
      id: 'vigencia',
      title: 'Vigencia y version del documento',
      paragraphs: [
        'Este documento rige para el portal de asamblea del Conjunto Cerrado Vegas del Rio P.H. desde su fecha de actualizacion y permanecera vigente hasta que la administracion publique una nueva version.',
        'Cuando exista una nueva version, el sistema solicitara una nueva aceptacion antes de permitir el ingreso del residente.',
      ],
    },
  ],
};

const buildResidentLegalHash = (document: ResidentLegalDocumentSeed) =>
  createHash('sha256').update(JSON.stringify(document)).digest('hex');

export const getCurrentResidentLegalDocument = (): ResidentLegalDocument => ({
  ...RESIDENT_ACCESS_LEGAL_SEED,
  contentHash: buildResidentLegalHash(RESIDENT_ACCESS_LEGAL_SEED),
});
