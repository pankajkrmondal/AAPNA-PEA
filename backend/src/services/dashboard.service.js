/**
 * dashboard.service.js — the at-a-glance view.
 *
 * Harish's summary of what the whole system is for: "Lets say if they want to
 * see some data … I can see at a quick glance what is happening. That is the
 * only purpose that we need to solve."
 *
 * So this answers the questions HR was scanning the spreadsheet for, plus two
 * it could never answer at all:
 *
 *   · overdue        — due, and nobody has been asked yet. In the old system a
 *                      missed evaluation left no trace anywhere; it simply
 *                      never happened and nobody knew.
 *   · awaiting       — asked, but the manager has not responded. Previously
 *                      indistinguishable from "not yet sent", because both
 *                      looked like an empty cell.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import { todayIn, toDateString, addDays } from '../utils/dateUtils.js';

/**
 * Headline counts plus the lists HR needs to act on.
 * @returns {Promise<object>}
 */
export async function getDashboard() {
  const today = todayIn(config.scheduler.timezone);
  const soon = addDays(today, 14);

  const activeEmployee = { halt_process: false, employment_status: 'active' };

  const [
    totalEmployees,
    activeEmployees,
    freshers,
    experienced,
    inProbation,
    confirmed,
    notConfirmed,
    extended,
    halted,
    left,
    overdue,
    awaiting,
    dueSoon,
    completedCycles,
    totalCycles,
  ] = await Promise.all([
    prisma.pea_employees.count(),
    prisma.pea_employees.count({ where: { employment_status: 'active' } }),
    prisma.pea_employees.count({ where: { is_experienced: false, employment_status: 'active' } }),
    prisma.pea_employees.count({ where: { is_experienced: true, employment_status: 'active' } }),
    prisma.pea_employees.count({ where: { confirmation_status: null, employment_status: 'active' } }),
    prisma.pea_employees.count({ where: { confirmation_status: 'Confirmed' } }),
    prisma.pea_employees.count({ where: { confirmation_status: 'Not Confirmed' } }),
    prisma.pea_employees.count({ where: { confirmation_status: { startsWith: 'Extend' } } }),
    prisma.pea_employees.count({ where: { halt_process: true } }),
    prisma.pea_employees.count({ where: { employment_status: 'left' } }),

    // Due, still pending — nobody has been asked.
    prisma.pea_evaluation_cycles.count({
      where: { status: 'pending', due_date: { lte: today }, employee: activeEmployee },
    }),
    // Asked, no response yet.
    prisma.pea_evaluation_cycles.count({
      where: { status: { in: ['email_sent', 'opened'] }, employee: activeEmployee },
    }),
    prisma.pea_evaluation_cycles.count({
      where: { status: 'pending', due_date: { gt: today, lte: soon }, employee: activeEmployee },
    }),
    prisma.pea_evaluation_cycles.count({ where: { status: 'completed' } }),
    prisma.pea_evaluation_cycles.count(),
  ]);

  // The action lists. Overdue is ordered oldest-first because that is the one
  // someone has been waiting longest for.
  const [overdueList, awaitingList, upcomingList, recentSubmissions] = await Promise.all([
    prisma.pea_evaluation_cycles.findMany({
      where: { status: 'pending', due_date: { lte: today }, employee: activeEmployee },
      include: { employee: { select: { id: true, full_name: true, rm_name: true, rm_email: true } } },
      orderBy: { due_date: 'asc' },
      take: 25,
    }),
    prisma.pea_evaluation_cycles.findMany({
      where: { status: { in: ['email_sent', 'opened'] }, employee: activeEmployee },
      include: { employee: { select: { id: true, full_name: true, rm_name: true, rm_email: true } } },
      orderBy: { sent_at: 'asc' },
      take: 25,
    }),
    prisma.pea_evaluation_cycles.findMany({
      where: { status: 'pending', due_date: { gt: today, lte: soon }, employee: activeEmployee },
      include: { employee: { select: { id: true, full_name: true, rm_name: true } } },
      orderBy: { due_date: 'asc' },
      take: 25,
    }),
    prisma.pea_evaluation_cycles.findMany({
      where: { status: 'completed', submitted_at: { not: null } },
      include: { employee: { select: { id: true, full_name: true } } },
      orderBy: { submitted_at: 'desc' },
      take: 10,
    }),
  ]);

  const ratingAgg = await prisma.pea_evaluation_cycles.aggregate({
    where: { status: 'completed', avg_rating: { not: null } },
    _avg: { avg_rating: true },
  });

  const daysLate = (d) => Math.round((today - new Date(d)) / 86_400_000);

  return {
    today: toDateString(today),
    timezone: config.scheduler.timezone,

    employees: {
      total: totalEmployees,
      active: activeEmployees,
      freshers,
      experienced,
      inProbation,
      confirmed,
      notConfirmed,
      extended,
      halted,
      left,
    },

    evaluations: {
      total: totalCycles,
      completed: completedCycles,
      overdue,
      awaitingResponse: awaiting,
      dueInNext14Days: dueSoon,
      averageRating: ratingAgg._avg.avg_rating ? Number(ratingAgg._avg.avg_rating) : null,
    },

    overdueList: overdueList.map((c) => ({
      cycleId: String(c.id),
      employeeId: String(c.employee.id),
      employee: c.employee.full_name,
      rm: c.employee.rm_name,
      rmEmail: c.employee.rm_email,
      seqNo: c.seq_no,
      dueDate: toDateString(c.due_date),
      daysLate: daysLate(c.due_date),
    })),

    awaitingList: awaitingList.map((c) => ({
      cycleId: String(c.id),
      employeeId: String(c.employee.id),
      employee: c.employee.full_name,
      rm: c.employee.rm_name,
      rmEmail: c.employee.rm_email,
      seqNo: c.seq_no,
      sentAt: c.sent_at,
      daysWaiting: c.sent_at ? daysLate(c.sent_at) : null,
      remindersSent: c.reminder_count,
      opened: !!c.opened_at,
    })),

    upcomingList: upcomingList.map((c) => ({
      cycleId: String(c.id),
      employeeId: String(c.employee.id),
      employee: c.employee.full_name,
      rm: c.employee.rm_name,
      seqNo: c.seq_no,
      dueDate: toDateString(c.due_date),
    })),

    recentSubmissions: recentSubmissions.map((c) => ({
      cycleId: String(c.id),
      employeeId: String(c.employee.id),
      employee: c.employee.full_name,
      seqNo: c.seq_no,
      average: c.avg_rating ? Number(c.avg_rating) : null,
      submittedAt: c.submitted_at,
      submittedBy: c.submitted_by_email,
      confirmation: c.confirmation_status,
    })),
  };
}

/**
 * Rows that look wrong and need a human.
 *
 * Every one of these was invisible in the spreadsheet: a missing RM email just
 * meant the flow silently skipped that person forever. Surfacing them is how a
 * silent failure becomes a visible one.
 *
 * @returns {Promise<object>}
 */
export async function getDataQuality() {
  const today = todayIn(config.scheduler.timezone);

  const [missingContacts, noSchedule, stuckAwaiting, noConfirmationPastDue] = await Promise.all([
    // The completeness guard the original flow applied before every send.
    prisma.pea_employees.findMany({
      where: {
        employment_status: 'active',
        OR: [{ rm_email: '' }, { pl_email: '' }, { rm_name: '' }],
      },
      select: { id: true, full_name: true, office_email: true, rm_name: true, rm_email: true, pl_email: true },
      take: 50,
    }),

    prisma.$queryRaw`
      SELECT e.id, e.full_name, e.office_email, e.doj
        FROM pea_employees e
       WHERE e.employment_status = 'active'
         AND NOT EXISTS (SELECT 1 FROM pea_evaluation_cycles c WHERE c.employee_id = e.id)
       LIMIT 50`,

    // Chased twice and still nothing back.
    prisma.pea_evaluation_cycles.findMany({
      where: {
        status: { in: ['email_sent', 'opened'] },
        reminder_count: { gte: 2 },
        employee: { halt_process: false, employment_status: 'active' },
      },
      include: { employee: { select: { id: true, full_name: true, rm_name: true, rm_email: true } } },
      orderBy: { sent_at: 'asc' },
      take: 50,
    }),

    // Every evaluation done, but no decision recorded — the probation has no
    // ending, which is exactly the state the spreadsheet used to leave people in.
    prisma.$queryRaw`
      SELECT e.id, e.full_name, e.office_email, e.doj
        FROM pea_employees e
       WHERE e.employment_status = 'active'
         AND e.confirmation_status IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM pea_evaluation_cycles c
            WHERE c.employee_id = e.id AND c.status IN ('pending','email_sent','opened')
         )
         AND EXISTS (SELECT 1 FROM pea_evaluation_cycles c WHERE c.employee_id = e.id)
       LIMIT 50`,
  ]);

  return {
    today: toDateString(today),
    issues: {
      missingContactDetails: missingContacts.length,
      noScheduleGenerated: noSchedule.length,
      noResponseAfterTwoReminders: stuckAwaiting.length,
      finishedWithoutDecision: noConfirmationPastDue.length,
    },
    missingContactDetails: missingContacts,
    noScheduleGenerated: noSchedule,
    noResponseAfterTwoReminders: stuckAwaiting.map((c) => ({
      cycleId: String(c.id),
      employee: c.employee.full_name,
      rm: c.employee.rm_name,
      rmEmail: c.employee.rm_email,
      seqNo: c.seq_no,
      sentAt: c.sent_at,
      remindersSent: c.reminder_count,
    })),
    finishedWithoutDecision: noConfirmationPastDue,
  };
}
