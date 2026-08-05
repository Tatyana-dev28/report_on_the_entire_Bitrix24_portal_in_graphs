import type { ReportEmployee } from '../types';
import type { PortalEmployeeItem } from '../../services/api/reportApiClient';
import type { ReportPoint } from '../../services/report/reportCatalog';

export type EmployeeDirectoryItem = PortalEmployeeItem & {
  isActive?: boolean;
  isRobot?: boolean;
  isTechnical?: boolean;
  workPosition?: string | null;
  department?: string | null;
  departmentIds?: string[];
  departments?: Array<{ id: string; name: string }>;
};

export const NO_DEPARTMENT_ID = '__none__';
export const NO_DEPARTMENT_LABEL = 'Без подразделения';

export type EmployeeDepartmentGroup = {
  id: string;
  label: string;
  employeeIds: string[];
};

/** Backend buckets rows without ASSIGNED/RESPONSIBLE into this id. */
export const UNASSIGNED_EMPLOYEE_ID = 'unknown';
export const UNAVAILABLE_EMPLOYEE_ID = '__unavailable__';
export const UNASSIGNED_EMPLOYEE_LABEL = 'Без ответственного';
export const UNAVAILABLE_EMPLOYEE_LABEL = 'Недоступно';

export const getEmployeeFullName = (employee: Pick<ReportEmployee, 'firstName' | 'lastName' | 'name' | 'id'>) => {
  if (employee.id === UNASSIGNED_EMPLOYEE_ID) {
    return UNASSIGNED_EMPLOYEE_LABEL;
  }

  if (employee.id === UNAVAILABLE_EMPLOYEE_ID) {
    return UNAVAILABLE_EMPLOYEE_LABEL;
  }

  return `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim()
    || employee.name?.trim()
    || `Сотрудник ${employee.id}`;
};

export const getEmployeeInitials = (employee: Pick<ReportEmployee, 'firstName' | 'lastName' | 'name' | 'id'>) => {
  const fullName = getEmployeeFullName(employee);
  const parts = fullName.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toLocaleUpperCase('ru-RU');
  }

  return (parts[0]?.slice(0, 2) || employee.id.slice(0, 2) || '?').toLocaleUpperCase('ru-RU');
};

export const getEmployeeSecondaryLabel = (
  employee: ReportEmployee,
  options?: { forceDisambiguation?: boolean },
) => {
  if (employee.department) {
    return employee.department;
  }

  if (employee.workPosition) {
    return employee.workPosition;
  }

  if (options?.forceDisambiguation) {
    return `ID ${employee.id}`;
  }

  return null;
};

export const detectRobotByName = (name: string) => {
  const normalized = name.trim().toLocaleLowerCase('ru-RU');

  return normalized.includes('робот') || normalized.includes(' bot') || normalized.startsWith('bot ');
};

export const enrichEmployeesWithDirectory = (
  employees: ReportEmployee[],
  directory: EmployeeDirectoryItem[],
): ReportEmployee[] => {
  if (!directory.length) {
    return employees.map((employee) => ({
      ...employee,
      isActive: employee.isActive ?? true,
      isRobot: employee.isRobot ?? detectRobotByName(employee.name || getEmployeeFullName(employee)),
      isTechnical: employee.isTechnical ?? false,
    }));
  }

  const byId = new Map(directory.map((item) => [item.id, item]));

  return employees.map((employee) => {
    const meta = byId.get(employee.id);
    const fullName = employee.name || getEmployeeFullName(employee);

    if (!meta) {
      return {
        ...employee,
        isActive: employee.isActive ?? true,
        isRobot: employee.isRobot ?? detectRobotByName(fullName),
        isTechnical: employee.isTechnical ?? false,
      };
    }

    return {
      ...employee,
      name: meta.name || fullName,
      firstName: meta.firstName || employee.firstName,
      lastName: meta.lastName || employee.lastName,
      avatarUrl: meta.avatarUrl ?? employee.avatarUrl,
      isActive: meta.isActive ?? true,
      isRobot: meta.isRobot ?? detectRobotByName(meta.name || fullName),
      isTechnical: meta.isTechnical ?? false,
      workPosition: meta.workPosition ?? employee.workPosition,
      department: meta.department ?? employee.department,
      departmentIds: meta.departmentIds ?? employee.departmentIds,
      departments: meta.departments ?? employee.departments,
    };
  });
};

const resolveEmployeeDepartments = (
  employee: ReportEmployee,
): Array<{ id: string; name: string }> => {
  if (employee.departments?.length) {
    return employee.departments;
  }

  const departmentIds = employee.departmentIds?.filter(Boolean) ?? [];
  if (!departmentIds.length) {
    return [];
  }

  const names = (employee.department ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return departmentIds.map((id, index) => ({
    id,
    name: names[index] || (departmentIds.length === 1 ? (employee.department || `Подразделение ${id}`) : `Подразделение ${id}`),
  }));
};

/** Groups selectable employees by department (multi-dept users appear in each). */
export const buildEmployeeDepartmentGroups = (
  employees: ReportEmployee[],
): EmployeeDepartmentGroup[] => {
  const groups = new Map<string, EmployeeDepartmentGroup>();

  const addToGroup = (id: string, label: string, employeeId: string) => {
    const existing = groups.get(id);

    if (existing) {
      if (!existing.employeeIds.includes(employeeId)) {
        existing.employeeIds.push(employeeId);
      }

      if (existing.label.startsWith('Подразделение ') && !label.startsWith('Подразделение ')) {
        existing.label = label;
      }

      return;
    }

    groups.set(id, {
      id,
      label,
      employeeIds: [employeeId],
    });
  };

  employees.forEach((employee) => {
    const departments = resolveEmployeeDepartments(employee);

    if (!departments.length) {
      addToGroup(NO_DEPARTMENT_ID, NO_DEPARTMENT_LABEL, employee.id);
      return;
    }

    departments.forEach((department) => {
      addToGroup(department.id, department.name, employee.id);
    });
  });

  return Array.from(groups.values()).sort((left, right) => {
    if (left.id === NO_DEPARTMENT_ID) {
      return 1;
    }

    if (right.id === NO_DEPARTMENT_ID) {
      return -1;
    }

    return left.label.localeCompare(right.label, 'ru-RU');
  });
};

export const isSystemEmployeeRow = (employeeId: string) =>
  employeeId === UNASSIGNED_EMPLOYEE_ID || employeeId === UNAVAILABLE_EMPLOYEE_ID;

const employeeHasMetricValues = (
  employee: ReportEmployee,
  metricId: string,
  reportData: ReportPoint[],
  readValue: (employee: ReportEmployee, point: ReportPoint, metricId: string) => number,
) => reportData.some((point) => readValue(employee, point, metricId) !== 0);

export type EmployeeDetailResolution = {
  employees: ReportEmployee[];
  mismatchHint: string | null;
};

/**
 * Builds the employee detail list under a metric: selected people + auto
 * «Без ответственного» when present, + residual «Недоступно» when totals diverge.
 */
export const resolveEmployeeDetailList = ({
  selectedEmployees,
  allEmployees,
  metricId,
  metricType,
  reportData,
  readMetricTotal,
  readEmployeeValue,
}: {
  selectedEmployees: ReportEmployee[];
  allEmployees: ReportEmployee[];
  metricId: string;
  metricType: 'number' | 'money' | 'percent';
  reportData: ReportPoint[];
  readMetricTotal: (point: ReportPoint) => number;
  readEmployeeValue: (employee: ReportEmployee, point: ReportPoint, metricId: string) => number;
}): EmployeeDetailResolution => {
  const selectedIds = new Set(selectedEmployees.map((employee) => employee.id));
  const result: ReportEmployee[] = [...selectedEmployees];

  const unassigned = allEmployees.find((employee) => employee.id === UNASSIGNED_EMPLOYEE_ID);

  if (
    unassigned
    && !selectedIds.has(UNASSIGNED_EMPLOYEE_ID)
    && employeeHasMetricValues(unassigned, metricId, reportData, readEmployeeValue)
  ) {
    result.push({
      ...unassigned,
      name: UNASSIGNED_EMPLOYEE_LABEL,
      firstName: UNASSIGNED_EMPLOYEE_LABEL,
      lastName: '',
    });
  }

  if (metricType === 'percent' || reportData.length === 0) {
    return { employees: result, mismatchHint: null };
  }

  const valuesByPeriod: Record<string, Record<string, number>> = {};
  let positiveGapTotal = 0;
  let negativeGapTotal = 0;

  reportData.forEach((point) => {
    const total = readMetricTotal(point);
    const detailSum = result.reduce(
      (sum, employee) => sum + readEmployeeValue(employee, point, metricId),
      0,
    );
    const gap = Math.round((total - detailSum) * 1000) / 1000;

    if (gap > 0) {
      positiveGapTotal += gap;
      valuesByPeriod[point.key] = { [metricId]: gap };
    } else if (gap < 0) {
      negativeGapTotal += Math.abs(gap);
    }
  });

  if (positiveGapTotal > 0) {
    result.push({
      id: UNAVAILABLE_EMPLOYEE_ID,
      userId: 0,
      name: UNAVAILABLE_EMPLOYEE_LABEL,
      firstName: UNAVAILABLE_EMPLOYEE_LABEL,
      lastName: '',
      valuesByPeriod,
    });

    return {
      employees: result,
      mismatchHint:
        'Сумма по сотрудникам меньше общего показателя. Разница учтена в строке «Недоступно» (нет ответственного в выборке или ограничен доступ).',
    };
  }

  if (negativeGapTotal > 0) {
    return {
      employees: result,
      mismatchHint:
        'Сумма по сотрудникам больше общего показателя. Проверьте, что одна сущность не учитывается несколько раз.',
    };
  }

  return { employees: result, mismatchHint: null };
};

