export type CategoryEntry = {
  title: string
  committedDays: string
  actualDays: string
  reason: string
}

export type CaseReport = {
  id?: string
  created_at?: string
  firstName: string
  middleName: string
  lastName: string
  nameSuffix: string
  phone: string
  personalEmail: string
  workEmail: string
  department: string
  categories: CategoryEntry[]
}
