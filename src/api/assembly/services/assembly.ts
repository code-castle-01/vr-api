import { factories } from '@strapi/strapi';
import { RESIDENT_ACCESS_LEGAL_KEY } from '../../../utils/resident-legal';
import {
  getAssemblyQuorumSummary,
  isAdminRole,
  normalizeResidentName,
  normalizeResidentUnit,
  parseNumericValue,
  serializeSupportDocument,
} from '../../../utils/resident-session';

const { jsPDF } = require('jspdf');
const autoTableModule = require('jspdf-autotable');
const autoTable = autoTableModule.default ?? autoTableModule;

type AssemblyEntity = {
  date?: string | null;
  id: number;
  status?: 'scheduled' | 'in_progress' | 'finished' | null;
  title?: string | null;
};

type UserEntity = {
  NombreCompleto?: string | null;
  UnidadPrivada?: string | null;
  id: number;
  role?: {
    name?: string | null;
    type?: string | null;
  } | null;
  username?: string | null;
};

type AgendaItemEntity = {
  id: number;
  requiresSpecialMajority?: boolean | null;
  status?: 'pending' | 'open' | 'closed' | null;
  title?: string | null;
  vote_options?: Array<{
    id: number;
    text?: string | null;
  }> | null;
};

type VoteRow = {
  agenda_item?: number | { id: number } | null;
  createdAt?: string | null;
  id: number;
  mechanism?: string | null;
  user?: number | UserEntity | null;
  vote_option?: number | { id: number; text?: string | null } | null;
  weight?: number | string | null;
};

type ProxyAuthorizationRow = {
  createdAt?: string | null;
  id: number;
  represented_user?: UserEntity | null;
  revoked_at?: string | null;
  revoked_by?: UserEntity | null;
  revoked_reason?: string | null;
  status?: 'submitted' | 'revoked' | null;
  submitted_by?: UserEntity | null;
  support_document?: {
    id: number;
    mime?: string | null;
    name?: string | null;
    size?: number | null;
    url?: string | null;
  } | null;
};

type AttendanceRow = {
  access_mode?: string | null;
  checkInTime?: string | null;
  id: number;
  proxy_user?: UserEntity | null;
  representation_locked?: boolean | null;
  user?: UserEntity | null;
};

type LegalAcceptanceRow = {
  accepted_at?: string | null;
  document_hash?: string | null;
  document_key?: string | null;
  document_version?: string | null;
  id: number;
  ip_address?: string | null;
  user?: UserEntity | null;
  user_agent?: string | null;
};

type PdfTableColumnStyles = Record<number, Record<string, unknown>>;

type NominalVote = {
  mechanism: string;
  optionLabels: string[];
  recordedAt: string | null;
  userId: number;
  userName: string;
  userUnit: string | null;
  weight: number;
};

type SurveyOption = {
  id: number;
  text: string;
  totalRecords: number;
  totalWeight: number;
};

type SurveyReport = {
  id: number;
  nominalVotes: NominalVote[];
  options: SurveyOption[];
  participantsCount: number;
  participantsWeight: number;
  requiresSpecialMajority: boolean;
  resultLabel: string;
  statusLabel: string;
  title: string;
};

const STATUS_LABELS: Record<string, string> = {
  closed: 'Cerrada',
  open: 'Abierta',
  pending: 'Pendiente',
};

const MECHANISM_LABELS: Record<string, string> = {
  correspondence: 'Correspondencia',
  electronic: 'Electronico',
  in_person: 'Presencial',
  proxy: 'Poder',
};

const ACCESS_MODE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  proxy: 'Apoderado',
};

const REPORT_TIMEZONE = 'America/Bogota';

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return 'Sin fecha';
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: REPORT_TIMEZONE,
  }).format(parsedDate);
};

const formatWeight = (value: number) => parseNumericValue(value).toFixed(6);

const toPdfText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const getEntityId = (value: number | { id: number } | null | undefined) => {
  if (typeof value === 'number') {
    return value;
  }

  return value?.id;
};

const normalizeMechanism = (value?: string | null) =>
  MECHANISM_LABELS[value ?? ''] ?? value ?? 'No definido';

const normalizeAccessMode = (value?: string | null) =>
  ACCESS_MODE_LABELS[value ?? ''] ?? value ?? 'No definido';

const resolvePublicUrl = () => {
  const rawValue = process.env.PUBLIC_URL?.trim();

  if (!rawValue) {
    return '';
  }

  try {
    return new URL(rawValue).toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

const buildAbsoluteUrl = (url?: string | null) => {
  if (!url) {
    return null;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const publicUrl = resolvePublicUrl();

  if (!publicUrl) {
    return url;
  }

  return `${publicUrl}${url.startsWith('/') ? '' : '/'}${url}`;
};

const buildSurveyReports = (agendaItems: AgendaItemEntity[], voteRows: VoteRow[]) => {
  const votesByAgenda = new Map<number, VoteRow[]>();

  for (const voteRow of voteRows) {
    const agendaItemId = getEntityId(voteRow.agenda_item as number | { id: number } | null);

    if (!agendaItemId) {
      continue;
    }

    const existingRows = votesByAgenda.get(agendaItemId);

    if (existingRows) {
      existingRows.push(voteRow);
      continue;
    }

    votesByAgenda.set(agendaItemId, [voteRow]);
  }

  return agendaItems.map((agendaItem) => {
    const rows = (votesByAgenda.get(agendaItem.id) ?? []).slice().sort((left, right) =>
      String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
    );
    const optionsMap = new Map<number, SurveyOption>();

    for (const option of agendaItem.vote_options ?? []) {
      optionsMap.set(option.id, {
        id: option.id,
        text: option.text ?? `Opcion ${option.id}`,
        totalRecords: 0,
        totalWeight: 0,
      });
    }

    const nominalVotesByUser = new Map<
      number,
      {
        mechanism: string;
        optionLabels: Set<string>;
        recordedAt: string | null;
        userId: number;
        userName: string;
        userUnit: string | null;
        weight: number;
      }
    >();

    for (const row of rows) {
      const optionId = getEntityId(row.vote_option as number | { id: number } | null);
      const userId = getEntityId(row.user as number | { id: number } | null);
      const optionText =
        typeof row.vote_option === 'object' && row.vote_option !== null
          ? row.vote_option.text ?? null
          : null;
      const weight = parseNumericValue(row.weight);

      if (optionId) {
        const option = optionsMap.get(optionId) ?? {
          id: optionId,
          text: optionText ?? `Opcion ${optionId}`,
          totalRecords: 0,
          totalWeight: 0,
        };
        option.totalRecords += 1;
        option.totalWeight += weight;
        optionsMap.set(optionId, option);
      }

      if (!userId) {
        continue;
      }

      const currentUser =
        typeof row.user === 'object' && row.user !== null ? (row.user as UserEntity) : null;
      const existingNominalVote = nominalVotesByUser.get(userId);

      if (existingNominalVote) {
        if (optionText) {
          existingNominalVote.optionLabels.add(optionText);
        }

        if (!existingNominalVote.recordedAt && row.createdAt) {
          existingNominalVote.recordedAt = row.createdAt;
        }

        if (!existingNominalVote.weight && weight > 0) {
          existingNominalVote.weight = weight;
        }

        continue;
      }

      nominalVotesByUser.set(userId, {
        mechanism: normalizeMechanism(row.mechanism),
        optionLabels: new Set(optionText ? [optionText] : []),
        recordedAt: row.createdAt ?? null,
        userId,
        userName: normalizeResidentName(currentUser),
        userUnit: normalizeResidentUnit(currentUser?.UnidadPrivada ?? currentUser?.username ?? ''),
        weight,
      });
    }

    const nominalVotes: NominalVote[] = Array.from(nominalVotesByUser.values())
      .map((entry) => ({
        mechanism: entry.mechanism,
        optionLabels: Array.from(entry.optionLabels),
        recordedAt: entry.recordedAt,
        userId: entry.userId,
        userName: entry.userName,
        userUnit: entry.userUnit,
        weight: entry.weight,
      }))
      .sort((left, right) => (left.userUnit ?? '').localeCompare(right.userUnit ?? '', 'es'));

    const participantsWeight = nominalVotes.reduce(
      (sum, nominalVote) => sum + parseNumericValue(nominalVote.weight),
      0
    );
    const options = Array.from(optionsMap.values()).sort((left, right) => {
      if (right.totalWeight !== left.totalWeight) {
        return right.totalWeight - left.totalWeight;
      }

      if (right.totalRecords !== left.totalRecords) {
        return right.totalRecords - left.totalRecords;
      }

      return left.text.localeCompare(right.text, 'es');
    });
    const winner = options[0];
    const second = options[1];
    const hasTie =
      Boolean(winner && second) &&
      winner.totalWeight === second.totalWeight &&
      winner.totalRecords === second.totalRecords;
    const requiresSpecialMajority = Boolean(agendaItem.requiresSpecialMajority);
    const winnerShare =
      winner && participantsWeight > 0 ? (winner.totalWeight / participantsWeight) * 100 : 0;
    const meetsThreshold = !requiresSpecialMajority || winnerShare >= 70;

    let resultLabel = 'Sin votos';

    if (options.length && participantsWeight > 0 && hasTie) {
      resultLabel = 'Empate tecnico';
    } else if (options.length && participantsWeight > 0) {
      resultLabel = meetsThreshold ? 'Resultado vigente' : 'Sin umbral requerido';
    }

    return {
      id: agendaItem.id,
      nominalVotes,
      options,
      participantsCount: nominalVotes.length,
      participantsWeight,
      requiresSpecialMajority,
      resultLabel,
      statusLabel: STATUS_LABELS[agendaItem.status ?? ''] ?? 'Pendiente',
      title: agendaItem.title ?? `Encuesta ${agendaItem.id}`,
    } as SurveyReport;
  });
};

const buildPdf = (
  assembly: AssemblyEntity,
  generatedAt: string,
  summaryRows: string[][],
  aggregatedRows: string[][],
  surveyReports: SurveyReport[],
  activePowerRows: string[][],
  revokedPowerRows: string[][],
  attendanceRows: string[][],
  quorumRows: string[][],
  legalRows: string[][]
) => {
  const pdf = new jsPDF({ compress: true, format: 'a4', orientation: 'landscape', unit: 'pt' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginLeft = 28;
  const marginRight = 28;
  const contentWidth = pageWidth - marginLeft - marginRight;
  let cursorY = 34;

  const drawSection = (title: string, subtitle?: string) => {
    if (cursorY > pageHeight - 86) {
      pdf.addPage();
      cursorY = 34;
    }

    pdf.setFillColor(249, 246, 240);
    pdf.setDrawColor(224, 213, 199);
    pdf.roundedRect(marginLeft, cursorY, contentWidth, 52, 10, 10, 'FD');
    pdf.setTextColor(23, 35, 47);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(toPdfText(title), marginLeft + 12, cursorY + 22);

    if (subtitle) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(94, 106, 119);
      pdf.text(toPdfText(subtitle), marginLeft + 12, cursorY + 39);
    }

    cursorY += 64;
  };

  const drawTable = (
    head: string[],
    body: string[][],
    options?: {
      columnStyles?: PdfTableColumnStyles;
      fontSize?: number;
    }
  ) => {
    autoTable(pdf, {
      body,
      head: [head],
      margin: { left: marginLeft, right: marginRight },
      startY: cursorY,
      tableWidth: contentWidth,
      styles: {
        cellPadding: 4,
        fontSize: options?.fontSize ?? 8,
        lineColor: [224, 213, 199],
        lineWidth: 0.4,
        overflow: 'linebreak',
        textColor: [39, 55, 71],
      },
      headStyles: {
        fillColor: [191, 122, 45],
        textColor: [255, 255, 255],
      },
      alternateRowStyles: {
        fillColor: [252, 250, 246],
      },
      columnStyles: options?.columnStyles,
      theme: 'grid',
    });

    cursorY = (pdf as any).lastAutoTable.finalY + 14;
  };

  drawSection(
    'Informe exhaustivo de asamblea cerrada',
    `Asamblea ${assembly.id} - ${assembly.title ?? 'Sin titulo'} - Generado: ${formatDateTime(generatedAt)}`
  );
  drawTable(['Indicador', 'Valor'], summaryRows);

  drawSection('Resultados agregados por encuesta');
  drawTable(
    ['Encuesta ID', 'Titulo', 'Estado', 'Opcion', 'Registros', 'Peso opcion', 'Regla', 'Resultado'],
    aggregatedRows.length ? aggregatedRows : [['-', 'Sin resultados', '-', '-', '-', '-', '-', '-']],
    {
      columnStyles: {
        1: { cellWidth: 228 },
        3: { cellWidth: 120 },
        6: { cellWidth: 86 },
        7: { cellWidth: 92 },
      },
    }
  );

  for (const survey of surveyReports) {
    drawSection(
      `Detalle nominal - Encuesta ${survey.id}`,
      `${survey.title} | Participantes: ${survey.participantsCount} | Peso: ${formatWeight(
        survey.participantsWeight
      )}`
    );
    drawTable(
      ['Usuario ID', 'Unidad', 'Nombre', 'Opciones', 'Mecanismo', 'Peso', 'Fecha'],
      survey.nominalVotes.length
        ? survey.nominalVotes.map((nominalVote) => [
            String(nominalVote.userId),
            toPdfText(nominalVote.userUnit ?? 'Sin unidad'),
            toPdfText(nominalVote.userName),
            toPdfText(nominalVote.optionLabels.join(', ') || 'Sin opcion'),
            toPdfText(nominalVote.mechanism),
            formatWeight(nominalVote.weight),
            toPdfText(formatDateTime(nominalVote.recordedAt)),
          ])
        : [['-', '-', 'Sin votos registrados', '-', '-', '-', '-']],
      {
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 56 },
          2: { cellWidth: 148 },
          3: { cellWidth: 176 },
          4: { cellWidth: 76 },
          5: { cellWidth: 58 },
          6: { cellWidth: 96 },
        },
      }
    );
  }

  drawSection('Poderes activos');
  drawTable(
    [
      'ID',
      'Rep. unidad',
      'Representante',
      'Representado unidad',
      'Representado',
      'Registro',
      'Soporte',
      'Mime',
      'Tamano',
      'URL',
    ],
    activePowerRows.length
      ? activePowerRows
      : [['-', '-', 'Sin poderes activos', '-', '-', '-', '-', '-', '-', '-']],
    {
      columnStyles: {
        0: { cellWidth: 32 },
        1: { cellWidth: 44 },
        2: { cellWidth: 92 },
        3: { cellWidth: 48 },
        4: { cellWidth: 92 },
        5: { cellWidth: 82 },
        6: { cellWidth: 82 },
        7: { cellWidth: 58 },
        8: { cellWidth: 44 },
        9: { cellWidth: 166 },
      },
      fontSize: 7.6,
    }
  );

  drawSection('Poderes revocados');
  drawTable(
    [
      'ID',
      'Rep. unidad',
      'Representante',
      'Representado unidad',
      'Representado',
      'Revocado',
      'Motivo',
      'Soporte',
      'Mime',
      'Tamano',
      'URL',
    ],
    revokedPowerRows.length
      ? revokedPowerRows
      : [['-', '-', 'Sin poderes revocados', '-', '-', '-', '-', '-', '-', '-', '-']],
    {
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 40 },
        2: { cellWidth: 80 },
        3: { cellWidth: 46 },
        4: { cellWidth: 80 },
        5: { cellWidth: 74 },
        6: { cellWidth: 76 },
        7: { cellWidth: 76 },
        8: { cellWidth: 52 },
        9: { cellWidth: 40 },
        10: { cellWidth: 126 },
      },
      fontSize: 7.4,
    }
  );

  drawSection('Asistencia');
  drawTable(
    ['ID', 'Unidad', 'Residente', 'Modalidad', 'Check-in', 'Bloqueada', 'Voto', 'Proxy'],
    attendanceRows.length ? attendanceRows : [['-', '-', 'Sin asistencias', '-', '-', '-', '-', '-']],
    {
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 46 },
        2: { cellWidth: 140 },
        3: { cellWidth: 62 },
        4: { cellWidth: 98 },
        5: { cellWidth: 52 },
        6: { cellWidth: 40 },
        7: { cellWidth: 160 },
      },
    }
  );

  drawSection('Quorum');
  drawTable(['Indicador', 'Valor'], quorumRows);

  drawSection('Cumplimiento legal - detalle tecnico');
  drawTable(
    ['ID', 'Unidad', 'Residente', 'Aceptado', 'Version', 'Hash', 'IP', 'User-Agent'],
    legalRows.length ? legalRows : [['-', '-', 'Sin registros legales', '-', '-', '-', '-', '-']],
    {
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 50 },
        2: { cellWidth: 128 },
        3: { cellWidth: 98 },
        4: { cellWidth: 62 },
        5: { cellWidth: 156 },
        6: { cellWidth: 72 },
        7: { cellWidth: 178 },
      },
      fontSize: 7.4,
    }
  );

  const pages = pdf.getNumberOfPages();

  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setTextColor(94, 106, 119);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(
      toPdfText(`Asamblea ${assembly.id} - Informe generado ${formatDateTime(generatedAt)}`),
      marginLeft,
      pageHeight - 18
    );
    const pageLabel = `Pagina ${page} de ${pages}`;
    pdf.text(pageLabel, pageWidth - marginRight - pdf.getTextWidth(pageLabel), pageHeight - 18);
  }

  return Buffer.from(pdf.output('arraybuffer'));
};

export default factories.createCoreService('api::assembly.assembly', ({ strapi }) => ({
  async generateExhaustiveReport(assembly: AssemblyEntity) {
    const [agendaItems, voteRows, powers, attendances, legalAcceptances, quorum] = await Promise.all([
      strapi.entityService.findMany('api::agenda-item.agenda-item', {
        fields: ['id', 'title', 'status', 'requiresSpecialMajority'],
        filters: {
          assembly: {
            id: assembly.id,
          },
        },
        populate: {
          vote_options: {
            fields: ['id', 'text'],
          },
        },
        sort: {
          id: 'asc',
        },
      }) as Promise<AgendaItemEntity[]>,
      strapi.db.query('api::vote.vote').findMany({
        where: {
          agenda_item: {
            assembly: assembly.id,
          },
        },
        orderBy: {
          id: 'asc',
        },
        populate: {
          agenda_item: {
            fields: ['id'],
          },
          user: {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
          },
          vote_option: {
            fields: ['id', 'text'],
          },
        },
      }) as Promise<VoteRow[]>,
      strapi.db.query('api::proxy-authorization.proxy-authorization').findMany({
        where: {
          assembly: assembly.id,
        },
        orderBy: {
          id: 'asc',
        },
        populate: {
          represented_user: {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
          },
          submitted_by: {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
          },
          revoked_by: {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
          },
          support_document: true,
        },
      }) as Promise<ProxyAuthorizationRow[]>,
      strapi.db.query('api::attendance.attendance').findMany({
        where: {
          assembly: assembly.id,
        },
        orderBy: {
          id: 'asc',
        },
        populate: {
          proxy_user: {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
          },
          user: {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
            populate: {
              role: {
                fields: ['name', 'type'],
              },
            },
          },
        },
      }) as Promise<AttendanceRow[]>,
      strapi.db.query('api::legal-acceptance.legal-acceptance').findMany({
        where: {
          context: 'resident_login',
        },
        orderBy: [{ accepted_at: 'desc' }, { id: 'desc' }],
        populate: {
          user: {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
            populate: {
              role: {
                fields: ['name', 'type'],
              },
            },
          },
        },
      }) as Promise<LegalAcceptanceRow[]>,
      getAssemblyQuorumSummary(strapi as any, assembly.id),
    ]);

    const generatedAt = new Date().toISOString();
    const surveyReports = buildSurveyReports(agendaItems, voteRows);
    const voterIds = new Set(
      voteRows
        .map((voteRow) => getEntityId(voteRow.user as number | { id: number } | null))
        .filter((value): value is number => typeof value === 'number')
    );

    const activePowers = powers.filter((power) => power.status !== 'revoked');
    const revokedPowers = powers.filter((power) => power.status === 'revoked');

    const aggregatedRows = surveyReports.flatMap((survey) =>
      survey.options.map((option) => [
        String(survey.id),
        toPdfText(survey.title),
        toPdfText(survey.statusLabel),
        toPdfText(option.text),
        String(option.totalRecords),
        formatWeight(option.totalWeight),
        toPdfText(survey.requiresSpecialMajority ? 'Mayoría especial 70%' : 'Mayoría simple'),
        toPdfText(survey.resultLabel),
      ])
    );

    const activePowerRows = activePowers.map((power) => {
      const support = serializeSupportDocument(power.support_document);
      const supportUrl = buildAbsoluteUrl(support?.url ?? null);
      return [
        String(power.id),
        toPdfText(normalizeResidentUnit(power.submitted_by?.UnidadPrivada ?? power.submitted_by?.username ?? '')),
        toPdfText(normalizeResidentName(power.submitted_by)),
        toPdfText(normalizeResidentUnit(power.represented_user?.UnidadPrivada ?? power.represented_user?.username ?? '')),
        toPdfText(normalizeResidentName(power.represented_user)),
        toPdfText(formatDateTime(power.createdAt)),
        toPdfText(support?.name ?? 'Sin soporte'),
        toPdfText(support?.mime ?? 'Sin mime'),
        String(support?.size ?? 0),
        toPdfText(supportUrl ?? 'Sin enlace'),
      ];
    });

    const revokedPowerRows = revokedPowers.map((power) => {
      const support = serializeSupportDocument(power.support_document);
      const supportUrl = buildAbsoluteUrl(support?.url ?? null);
      return [
        String(power.id),
        toPdfText(normalizeResidentUnit(power.submitted_by?.UnidadPrivada ?? power.submitted_by?.username ?? '')),
        toPdfText(normalizeResidentName(power.submitted_by)),
        toPdfText(normalizeResidentUnit(power.represented_user?.UnidadPrivada ?? power.represented_user?.username ?? '')),
        toPdfText(normalizeResidentName(power.represented_user)),
        toPdfText(formatDateTime(power.revoked_at)),
        toPdfText(power.revoked_reason?.trim() || 'Sin motivo'),
        toPdfText(support?.name ?? 'Sin soporte'),
        toPdfText(support?.mime ?? 'Sin mime'),
        String(support?.size ?? 0),
        toPdfText(supportUrl ?? 'Sin enlace'),
      ];
    });

    const attendanceRows = attendances
      .filter((attendance) => attendance.user && !isAdminRole(attendance.user.role))
      .map((attendance) => [
        String(attendance.id),
        toPdfText(normalizeResidentUnit(attendance.user?.UnidadPrivada ?? attendance.user?.username ?? '')),
        toPdfText(normalizeResidentName(attendance.user)),
        toPdfText(normalizeAccessMode(attendance.access_mode)),
        toPdfText(formatDateTime(attendance.checkInTime)),
        attendance.representation_locked ? 'Si' : 'No',
        voterIds.has(attendance.user?.id ?? -1) ? 'Si' : 'No',
        toPdfText(
          attendance.proxy_user
            ? `${normalizeResidentUnit(attendance.proxy_user.UnidadPrivada ?? attendance.proxy_user.username ?? '')} - ${normalizeResidentName(attendance.proxy_user)}`
            : 'N/A'
        ),
      ]);

    const legalUsersById = new Map<number, UserEntity>();

    for (const attendance of attendances) {
      const attendanceUser = attendance.user;

      if (!attendanceUser || isAdminRole(attendanceUser.role)) {
        continue;
      }

      legalUsersById.set(attendanceUser.id, attendanceUser);
    }

    for (const legal of legalAcceptances) {
      const legalUser = legal.user;

      if (!legalUser || isAdminRole(legalUser.role)) {
        continue;
      }

      if (!legalUsersById.has(legalUser.id)) {
        legalUsersById.set(legalUser.id, legalUser);
      }
    }

    const legalByUserId = new Map<number, LegalAcceptanceRow>();
    const legalRowsWithCurrentKey = legalAcceptances.filter(
      (legal) => legal.document_key === RESIDENT_ACCESS_LEGAL_KEY
    );
    const legalRowsWithLegacyKey = legalAcceptances.filter(
      (legal) => legal.document_key !== RESIDENT_ACCESS_LEGAL_KEY
    );

    for (const legalCollection of [legalRowsWithCurrentKey, legalRowsWithLegacyKey]) {
      for (const legal of legalCollection) {
        const legalUser = legal.user;

        if (!legalUser || isAdminRole(legalUser.role) || legalByUserId.has(legalUser.id)) {
          continue;
        }

        legalByUserId.set(legalUser.id, legal);
      }
    }

    const quorumRows = [
      ['Casas habilitadas', String(quorum.enabledHomesCount)],
      ['Usuarios con ingreso', String(quorum.loggedUsersCount)],
      ['Quorum minimo', String(quorum.quorumMinHomes)],
      ['Quorum alcanzado', quorum.quorumReached ? 'Si' : 'No'],
      ['Total base de casas', String(quorum.totalHomesBase)],
    ].map((row) => row.map((value) => toPdfText(value)));

    const legalRows = Array.from(legalUsersById.values())
      .sort((left, right) => {
        const leftUnit = normalizeResidentUnit(left.UnidadPrivada ?? left.username ?? '');
        const rightUnit = normalizeResidentUnit(right.UnidadPrivada ?? right.username ?? '');

        if (leftUnit !== rightUnit) {
          return leftUnit.localeCompare(rightUnit, 'es');
        }

        return normalizeResidentName(left).localeCompare(normalizeResidentName(right), 'es');
      })
      .map((user) => {
        const legal = legalByUserId.get(user.id);

        return [
          String(legal?.id ?? '-'),
          toPdfText(normalizeResidentUnit(user.UnidadPrivada ?? user.username ?? '')),
          toPdfText(normalizeResidentName(user)),
          toPdfText(legal ? formatDateTime(legal.accepted_at) : 'Sin aceptacion'),
          toPdfText(legal?.document_version ?? 'Sin version'),
          toPdfText(legal?.document_hash ?? 'Sin hash'),
          toPdfText(legal?.ip_address ?? 'Sin IP'),
          toPdfText(legal?.user_agent ?? 'Sin User-Agent'),
        ];
      });
    const legalAcceptedCount = legalRows.filter((row) => row[0] !== '-').length;

    const summaryRows = [
      ['Asamblea', assembly.title ?? `Asamblea ${assembly.id}`],
      ['ID', String(assembly.id)],
      ['Fecha', formatDateTime(assembly.date)],
      ['Estado', 'Finalizada'],
      ['Encuestas', String(surveyReports.length)],
      ['Registros de voto', String(voteRows.length)],
      ['Votantes unicos', String(voterIds.size)],
      ['Poderes activos', String(activePowers.length)],
      ['Poderes revocados', String(revokedPowers.length)],
      ['Asistencias', String(attendanceRows.length)],
      ['Registros legales', String(legalAcceptedCount)],
      ['Usuarios auditados legal', String(legalRows.length)],
      ['Quorum', quorum.quorumReached ? 'Alcanzado' : 'Pendiente'],
    ].map((row) => row.map((value) => toPdfText(value)));

    const filename = `informe-asamblea-${assembly.id}-${generatedAt.replace(/[:.]/g, '-')}.pdf`;
    const buffer = buildPdf(
      assembly,
      generatedAt,
      summaryRows,
      aggregatedRows,
      surveyReports,
      activePowerRows,
      revokedPowerRows,
      attendanceRows,
      quorumRows,
      legalRows
    );

    return { buffer, filename };
  },
}));
