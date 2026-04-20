import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListOrdered, Plus, Sparkles, Trash2, X } from 'lucide-react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import './App.css'
import { caseCategories } from './data/categories'
import { officeTopCategories } from './data/officeTopCategories'
import {
  isSupabaseConfigured,
  supabase,
  supabaseEnvState,
} from './lib/supabase'
import type { CaseReport, CategoryEntry } from './types'

type CategoryMode = 'custom' | 'system'

const MIN_CATEGORIES = 1
const MAX_CATEGORIES = 10
const DRAFT_STORAGE_KEY = 'mynaga_case_form_draft_v1'
const COOKIE_CONSENT_KEY = 'mynaga_cookie_consent_v1'
const ADMIN_USERS_TABLE = 'admin_users'

const GENERIC_CATEGORY_PATTERNS = [
  /^others?$/i,
  /^other\b/i,
  /^public safety concerns$/i,
]

const normalizeCategoryTitle = (title: string) => title.replace(/\s+/g, ' ').trim()

const isGenericCategoryBucket = (title: string) =>
  GENERIC_CATEGORY_PATTERNS.some((pattern) => pattern.test(title))

const sanitizeCategoryTitles = (titles: string[]) => {
  const seen = new Set<string>()

  return titles
    .map(normalizeCategoryTitle)
    .filter((title) => title && !isGenericCategoryBucket(title))
    .filter((title) => {
      const key = title.toLowerCase()
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

const createCategoryEntries = (titles: string[]): CategoryEntry[] =>
  titles.map((title) => ({
    title,
    committedDays: '',
    actualDays: '',
    reason: '',
    cmoHelp: '',
  }))

const defaultCategoryTitles = [
  ...officeTopCategories.overall.categories.map((category) => category.name),
  ...caseCategories,
]
  .flatMap((category) => category)

const cleanedDefaultCategoryTitles = sanitizeCategoryTitles(defaultCategoryTitles)

const topDefaultCategoryTitles = cleanedDefaultCategoryTitles.slice(0, 10)

const getTopCategoryTitlesForOffice = (office: string) => {
  const officeMatch = officeTopCategories.offices.find(
    (entry) => entry.office.toUpperCase() === office.toUpperCase(),
  )

  const officeTitles =
    officeMatch?.categories.map((category) => category.name) ?? []

  const merged = [...officeTitles, ...topDefaultCategoryTitles]

  return sanitizeCategoryTitles(merged).slice(0, 10)
}

const getCustomCategoryTitles = () =>
  Array.from({ length: 10 }, (_, index) => `Custom Category ${index + 1}`)

const initialFormData = (): CaseReport => ({
  firstName: '',
  middleName: '',
  lastName: '',
  nameSuffix: '',
  phone: '',
  email: '',
  department: '',
  categories: createCategoryEntries(topDefaultCategoryTitles),
})

const formatFullName = (report: {
  firstName: string
  middleName: string
  lastName: string
  nameSuffix: string
}) =>
  [report.firstName, report.middleName, report.lastName, report.nameSuffix]
    .filter(Boolean)
    .join(' ')

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }

  return fallback
}

const getErrorCode = (error: unknown) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code
  }

  return ''
}

const parseMissingColumnFromError = (error: unknown) => {
  const message = getErrorMessage(error, '')
  const match = message.match(/'([^']+)' column/)
  return match?.[1] ?? ''
}

const normalizeReport = (row: Record<string, unknown>): CaseReport => {
  const firstName =
    (row.firstName as string | undefined) ??
    (row.first_name as string | undefined) ??
    (row.firstname as string | undefined) ??
    ''
  const middleName =
    (row.middleName as string | undefined) ??
    (row.middle_name as string | undefined) ??
    (row.middlename as string | undefined) ??
    ''
  const lastName =
    (row.lastName as string | undefined) ??
    (row.last_name as string | undefined) ??
    (row.lastname as string | undefined) ??
    ''
  const nameSuffix =
    (row.nameSuffix as string | undefined) ??
    (row.name_suffix as string | undefined) ??
    (row.namesuffix as string | undefined) ??
    ''
  const legacyName = (row.name as string | undefined) ?? ''

  return {
    id: (row.id as string | undefined) ?? undefined,
    created_at: (row.created_at as string | undefined) ?? undefined,
    firstName: firstName || (legacyName ? legacyName.split(' ')[0] : ''),
    middleName,
    lastName,
    nameSuffix,
    phone: (row.phone as string | undefined) ?? '',
    email:
      (row.email as string | undefined) ??
      (row.personalEmail as string | undefined) ??
      (row.personal_email as string | undefined) ??
      (row.personalemail as string | undefined) ??
      (row.workEmail as string | undefined) ??
      (row.work_email as string | undefined) ??
      (row.workemail as string | undefined) ??
      '',
    department: (row.department as string | undefined) ?? '',
    categories: Array.isArray(row.categories)
      ? (row.categories as Array<Record<string, unknown>>).map((category) => ({
          title: (category.title as string | undefined) ?? '',
          committedDays:
            (category.committedDays as string | undefined) ??
            (category.committed_days as string | undefined) ??
            '',
          actualDays:
            (category.actualDays as string | undefined) ??
            (category.actual_days as string | undefined) ??
            '',
          reason: (category.reason as string | undefined) ?? '',
          cmoHelp:
            (category.cmoHelp as string | undefined) ??
            (category.cmo_help as string | undefined) ??
            (category.howCanCmoHelp as string | undefined) ??
            '',
        }))
      : [],
  }
}

const getSupabaseMissingMessage = () => {
  const missing: string[] = []

  if (!supabaseEnvState.hasUrl) {
    missing.push('VITE_SUPABASE_URL')
  }

  if (!supabaseEnvState.hasAnonKey) {
    missing.push('VITE_SUPABASE_ANON_KEY')
  }

  return `Supabase environment variables are missing: ${missing.join(', ')}`
}

function App() {
  const [view, setView] = useState<'form' | 'admin' | 'analytics'>('form')
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<CaseReport>(() => initialFormData())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState<CaseReport | null>(null)
  const [reports, setReports] = useState<CaseReport[]>([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [selectedReport, setSelectedReport] = useState<CaseReport | null>(null)
  const [categoryMode, setCategoryMode] = useState<CategoryMode | null>(null)
  const [isCategoryModeModalOpen, setIsCategoryModeModalOpen] = useState(false)
  const [customCategoryError, setCustomCategoryError] = useState('')
  const [categoryValidationError, setCategoryValidationError] = useState('')
  const [categoryCountError, setCategoryCountError] = useState('')
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(true)
  const [hasAgreedToTerms, setHasAgreedToTerms] = useState(false)
  const [hasAcceptedCookies, setHasAcceptedCookies] = useState(false)
  const [isCookieBannerOpen, setIsCookieBannerOpen] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [officeFilter, setOfficeFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [dateFromFilter, setDateFromFilter] = useState('')
  const [dateToFilter, setDateToFilter] = useState('')
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [isAdminAuthModalOpen, setIsAdminAuthModalOpen] = useState(false)
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminSession, setAdminSession] = useState<{
    username: string
    password: string
  } | null>(null)
  const [adminAuthLoading, setAdminAuthLoading] = useState(false)
  const [adminAuthError, setAdminAuthError] = useState('')
  const adminPrintAreaRef = useRef<HTMLDivElement | null>(null)

  const isSupabaseReady = isSupabaseConfigured
  const departmentValue = formData.department.trim()
  const isCustomMode = categoryMode === 'custom'
  const hasSecondDetailsPage = formData.categories.length > 5
  const totalSteps = isCustomMode
    ? hasSecondDetailsPage
      ? 4
      : 3
    : hasSecondDetailsPage
      ? 3
      : 2
  const detailsStepOne = isCustomMode ? 3 : 2
  const detailsStepTwo = hasSecondDetailsPage ? detailsStepOne + 1 : detailsStepOne
  const selectedOfficeLabel = departmentValue || 'Selected Office'
  const selectedOfficeTopCategories = useMemo(
    () => getTopCategoryTitlesForOffice(departmentValue),
    [departmentValue],
  )

  const stepLabels = useMemo(() => {
    if (isCustomMode) {
      return hasSecondDetailsPage
        ? [
            'Personal Info',
            'Custom Categories',
            'Top Categories 1-5',
            'Top Categories 6-10',
          ]
        : ['Personal Info', 'Custom Categories', 'Top Categories']
    }

    return hasSecondDetailsPage
      ? ['Personal Info', 'Top Categories 1-5', 'Top Categories 6-10']
      : ['Personal Info', 'Top Categories']
  }, [isCustomMode, hasSecondDetailsPage])

  const officeFilterOptions = useMemo(
    () =>
      [...new Set(reports.map((report) => report.department.trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [reports],
  )

  const categoryFilterOptions = useMemo(
    () =>
      [
        ...new Set(
          reports
            .flatMap((report) => report.categories ?? [])
            .map((category) => category.title.trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [reports],
  )

  const filteredReports = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()

    return reports.filter((report) => {
      if (officeFilter && report.department !== officeFilter) {
        return false
      }

      if (
        categoryFilter &&
        !(report.categories ?? []).some(
          (category) => category.title.trim() === categoryFilter,
        )
      ) {
        return false
      }

      if (dateFromFilter || dateToFilter) {
        if (!report.created_at) {
          return false
        }

        const createdAt = new Date(report.created_at)

        if (Number.isNaN(createdAt.getTime())) {
          return false
        }

        if (dateFromFilter) {
          const fromDate = new Date(`${dateFromFilter}T00:00:00`)
          if (createdAt < fromDate) {
            return false
          }
        }

        if (dateToFilter) {
          const toDate = new Date(`${dateToFilter}T23:59:59.999`)
          if (createdAt > toDate) {
            return false
          }
        }
      }

      if (!keyword) {
        return true
      }

      const haystack = [
        formatFullName(report),
        report.phone,
        report.email,
        report.department,
        ...(report.categories ?? []).flatMap((category) => [
          category.title,
          category.reason,
          category.cmoHelp,
        ]),
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(keyword)
    })
  }, [
    reports,
    searchKeyword,
    officeFilter,
    categoryFilter,
    dateFromFilter,
    dateToFilter,
  ])

  useEffect(() => {
    if (step > totalSteps) {
      setStep(totalSteps)
    }
  }, [step, totalSteps])

  useEffect(() => {
    if (!selectedReport) {
      return
    }

    const isStillVisible = filteredReports.some(
      (report) => report.id === selectedReport.id,
    )

    if (!isStillVisible) {
      setSelectedReport(filteredReports[0] ?? null)
    }
  }, [filteredReports, selectedReport])

  useEffect(() => {
    try {
      const cookieConsent = localStorage.getItem(COOKIE_CONSENT_KEY)
      const isAccepted = cookieConsent === 'accepted'
      setHasAcceptedCookies(isAccepted)
      setIsCookieBannerOpen(!isAccepted)
    } catch {
      setHasAcceptedCookies(false)
      setIsCookieBannerOpen(true)
    }
  }, [])

  useEffect(() => {
    if (!hasAcceptedCookies) {
      return
    }

    try {
      const rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (!rawDraft) {
        return
      }

      const parsed = JSON.parse(rawDraft) as {
        formData?: Partial<CaseReport>
        step?: number
        categoryMode?: CategoryMode | null
      }

      if (parsed.categoryMode === 'custom' || parsed.categoryMode === 'system') {
        setCategoryMode(parsed.categoryMode)
      }

      if (parsed.formData) {
        const draftCategories = Array.isArray(parsed.formData.categories)
          ? parsed.formData.categories
              .slice(0, MAX_CATEGORIES)
              .map((category) => ({
                title: category.title ?? '',
                committedDays: category.committedDays ?? '',
                actualDays: category.actualDays ?? '',
                reason: category.reason ?? '',
                cmoHelp: category.cmoHelp ?? '',
              }))
          : initialFormData().categories

        setFormData((prev) => ({
          ...prev,
          ...parsed.formData,
          categories:
            draftCategories.length > 0
              ? draftCategories
              : initialFormData().categories.slice(0, MIN_CATEGORIES),
        }))
      }

      if (typeof parsed.step === 'number' && parsed.step >= 1) {
        setStep(parsed.step)
      }
    } catch {
      localStorage.removeItem(DRAFT_STORAGE_KEY)
    }
  }, [hasAcceptedCookies])

  useEffect(() => {
    if (!hasAcceptedCookies) {
      return
    }

    const draftPayload = {
      formData,
      step,
      categoryMode,
    }

    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftPayload))
  }, [formData, step, categoryMode, hasAcceptedCookies])

  useEffect(() => {
    if (categoryMode !== 'system') {
      return
    }

    setFormData((prev) => {
      const currentTitles = prev.categories.map((category) => category.title)
      const isSameShape =
        currentTitles.length === selectedOfficeTopCategories.length &&
        currentTitles.every(
          (title, index) => title === selectedOfficeTopCategories[index],
        )

      if (isSameShape) {
        return prev
      }

      const previousByTitle = new Map(
        prev.categories.map((category) => [category.title, category]),
      )

      const nextCategories = selectedOfficeTopCategories.map((title) => {
        const previous = previousByTitle.get(title)
        return previous
          ? { ...previous, title }
          : {
              title,
              committedDays: '',
              actualDays: '',
              reason: '',
              cmoHelp: '',
            }
      })

      return {
        ...prev,
        categories: nextCategories,
      }
    })
  }, [selectedOfficeTopCategories, categoryMode])

  const fetchReports = useCallback(async () => {
    if (!isSupabaseReady) {
      setAdminError(getSupabaseMissingMessage())
      return
    }

    setLoadingReports(true)
    setAdminError('')
    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.')
      }

      const { data, error } = await supabase
        .from('case_reports')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        throw error
      }

      const normalized = (data ?? []).map((row) =>
        normalizeReport(row as Record<string, unknown>),
      )
      setReports(normalized)
    } catch (error) {
      setAdminError(getErrorMessage(error, 'Unable to load submissions.'))
    } finally {
      setLoadingReports(false)
    }
  }, [isSupabaseReady])

  useEffect(() => {
    if (view === 'admin') {
      void fetchReports()
    }
  }, [view, fetchReports])

  const handleFieldChange = (field: keyof CaseReport, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleCategoryChange = (
    index: number,
    field: keyof CategoryEntry,
    value: string,
  ) => {
    setCategoryValidationError('')
    setFormData((prev) => {
      const updatedCategories = prev.categories.map((category, catIndex) =>
        catIndex === index ? { ...category, [field]: value } : category,
      )
      return { ...prev, categories: updatedCategories }
    })
  }

  const getMissingDetailCategoryIndex = (start: number, end: number) => {
    for (let index = start; index < Math.min(end, formData.categories.length); index += 1) {
      const category = formData.categories[index]

      if (
        !category.committedDays.trim() ||
        !category.actualDays.trim() ||
        !category.reason.trim() ||
        !category.cmoHelp.trim()
      ) {
        return index
      }
    }

    return -1
  }

  const handleAddCategory = () => {
    if (formData.categories.length >= MAX_CATEGORIES) {
      setCategoryCountError(`You can only add up to ${MAX_CATEGORIES} categories.`)
      return
    }

    setCategoryCountError('')
    setCustomCategoryError('')
    setCategoryValidationError('')

    const nextIndex = formData.categories.length + 1
    const nextTitle =
      categoryMode === 'custom'
        ? `Custom Category ${nextIndex}`
        : `Additional Category ${nextIndex}`

    setFormData((prev) => ({
      ...prev,
      categories: [
        ...prev.categories,
        {
          title: nextTitle,
          committedDays: '',
          actualDays: '',
          reason: '',
          cmoHelp: '',
        },
      ],
    }))
  }

  const handleRemoveCategory = (index: number) => {
    if (formData.categories.length <= MIN_CATEGORIES) {
      setCategoryCountError(`At least ${MIN_CATEGORIES} category is required.`)
      return
    }

    setCategoryCountError('')
    setCustomCategoryError('')
    setCategoryValidationError('')
    setFormData((prev) => ({
      ...prev,
      categories: prev.categories.filter((_, catIndex) => catIndex !== index),
    }))
  }

  const isPersonalValid =
    formData.firstName.trim() !== '' &&
    formData.middleName.trim() !== '' &&
    formData.lastName.trim() !== '' &&
    formData.phone.trim() !== '' &&
    formData.email.includes('@') &&
    formData.department.trim() !== ''

  const completedCustomCategories = formData.categories.filter(
    (category) => category.title.trim() !== '',
  ).length

  const handleNext = () => {
    setCategoryCountError('')

    if (step === 1) {
      if (!isPersonalValid) return
      setIsCategoryModeModalOpen(true)
      return
    }

    if (isCustomMode && step === 2) {
      const hasEmptyCategoryTitle = formData.categories.some(
        (category) => category.title.trim() === '',
      )

      if (hasEmptyCategoryTitle) {
        setCustomCategoryError('Please fill in all Top 10 custom category names.')
        return
      }

      setCustomCategoryError('')
    }

    if (step === detailsStepOne && hasSecondDetailsPage) {
      const invalidIndex = getMissingDetailCategoryIndex(0, 5)

      if (invalidIndex >= 0) {
        setCategoryValidationError(
          `Please complete Committed Days, Actual Days, Reason for Delays, and How can CMO help? for Top ${invalidIndex + 1} Category.`,
        )
        return
      }

      setCategoryValidationError('')
    }

    setStep((prev) => Math.min(prev + 1, totalSteps))
  }

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1))
  }

  const handleSubmit = async () => {
    setSubmitError('')
    setSubmitSuccess(null)

    const invalidIndex = getMissingDetailCategoryIndex(0, formData.categories.length)

    if (invalidIndex >= 0) {
      setCategoryValidationError(
        `Please complete Committed Days, Actual Days, Reason for Delays, and How can CMO help? for Top ${invalidIndex + 1} Category.`,
      )
      return
    }

    setCategoryValidationError('')

    if (!isSupabaseReady) {
      setSubmitError(getSupabaseMissingMessage())
      return
    }

    setSubmitting(true)
    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.')
      }

      const payload: CaseReport = {
        ...formData,
        categories: formData.categories,
      }

      const payloadVariants: Array<Record<string, unknown>> = [
        {
          ...payload,
          personalEmail: payload.email,
          workEmail: payload.email,
          personalemail: payload.email,
          workemail: payload.email,
          personal_email: payload.email,
          work_email: payload.email,
        },
        {
          firstName: payload.firstName,
          middleName: payload.middleName,
          lastName: payload.lastName,
          nameSuffix: payload.nameSuffix,
          firstname: payload.firstName,
          middlename: payload.middleName,
          lastname: payload.lastName,
          namesuffix: payload.nameSuffix,
          phone: payload.phone,
          email: payload.email,
          personalEmail: payload.email,
          workEmail: payload.email,
          personalemail: payload.email,
          workemail: payload.email,
          personal_email: payload.email,
          work_email: payload.email,
          department: payload.department,
          categories: payload.categories,
        },
        {
          firstName: payload.firstName,
          middleName: payload.middleName,
          lastName: payload.lastName,
          nameSuffix: payload.nameSuffix,
          first_name: payload.firstName,
          middle_name: payload.middleName,
          last_name: payload.lastName,
          name_suffix: payload.nameSuffix,
          phone: payload.phone,
          email: payload.email,
          personalEmail: payload.email,
          workEmail: payload.email,
          personal_email: payload.email,
          work_email: payload.email,
          personalemail: payload.email,
          workemail: payload.email,
          department: payload.department,
          categories: payload.categories,
        },
        {
          firstName: payload.firstName,
          middleName: payload.middleName,
          lastName: payload.lastName,
          nameSuffix: payload.nameSuffix,
          name: formatFullName(payload),
          phone: payload.phone,
          email: payload.email,
          personalEmail: payload.email,
          workEmail: payload.email,
          personalemail: payload.email,
          workemail: payload.email,
          personal_email: payload.email,
          work_email: payload.email,
          department: payload.department,
          categories: payload.categories,
        },
        {
          firstName: payload.firstName,
          middleName: payload.middleName,
          lastName: payload.lastName,
          nameSuffix: payload.nameSuffix,
          name: formatFullName(payload),
          phone: payload.phone,
          email: payload.email,
          personalEmail: payload.email,
          workEmail: payload.email,
          personalemail: payload.email,
          workemail: payload.email,
          personal_email: payload.email,
          work_email: payload.email,
          department: payload.department,
          categories: payload.categories,
        },
      ]

      let inserted: Record<string, unknown> | null = null
      let lastError: unknown = null

      for (const variant of payloadVariants) {
        const adaptivePayload = { ...variant }

        for (let attempt = 0; attempt < 10; attempt += 1) {
          const { data, error } = await supabase
            .from('case_reports')
            .insert([adaptivePayload])
            .select()
            .single()

          if (!error) {
            inserted = data as Record<string, unknown>
            break
          }

          lastError = error

          if (getErrorCode(error) !== 'PGRST204') {
            break
          }

          const missingColumn = parseMissingColumnFromError(error)
          if (!missingColumn || !(missingColumn in adaptivePayload)) {
            break
          }

          delete adaptivePayload[missingColumn]
        }

        if (inserted) {
          break
        }
      }

      if (!inserted) {
        throw lastError ?? new Error('Unable to submit the form right now.')
      }

      setSubmitSuccess({
        ...payload,
        ...normalizeReport(inserted),
        categories: payload.categories,
      })
      setFormData(initialFormData())
      setStep(1)
      setCategoryMode(null)
      setCustomCategoryError('')
      setCategoryCountError('')
      setCategoryValidationError('')
      localStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch (error) {
      setSubmitError(getErrorMessage(error, 'Unable to submit the form right now.'))
    } finally {
      setSubmitting(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadSubmission = async (report: CaseReport) => {
    const source = adminPrintAreaRef.current

    if (!source) {
      setAdminError('Unable to export PDF preview right now. Please try again.')
      return
    }

    const fullName = formatFullName(report) || 'Unnamed Submission'
    const safeName = fullName
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')

    const clone = source.cloneNode(true) as HTMLDivElement
    clone.querySelectorAll('.no-print').forEach((node) => node.remove())

    clone.style.width = `${source.getBoundingClientRect().width}px`
    clone.style.maxWidth = '1000px'
    clone.style.position = 'fixed'
    clone.style.left = '-10000px'
    clone.style.top = '0'
    clone.style.zIndex = '-1'
    clone.style.opacity = '1'
    clone.style.background = '#ffffff'

    document.body.appendChild(clone)

    try {
      const canvas = await html2canvas(clone, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      })

      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 20
      const contentWidth = pageWidth - margin * 2
      const contentHeight = pageHeight - margin * 2

      const pageContentPx = Math.floor((contentHeight * canvas.width) / contentWidth)
      const canvasContext = canvas.getContext('2d')

      const getInkScoreForRow = (row: number) => {
        if (!canvasContext) {
          return Number.MAX_SAFE_INTEGER
        }

        const rowData = canvasContext.getImageData(0, row, canvas.width, 1).data
        let inkScore = 0

        for (let x = 0; x < canvas.width; x += 8) {
          const pixelIndex = x * 4
          const alpha = rowData[pixelIndex + 3]

          if (alpha < 10) {
            continue
          }

          const red = rowData[pixelIndex]
          const green = rowData[pixelIndex + 1]
          const blue = rowData[pixelIndex + 2]

          if (red < 245 || green < 245 || blue < 245) {
            inkScore += 1
          }
        }

        return inkScore
      }

      const findCleanBreakRow = (startY: number, idealEndY: number) => {
        const searchFrom = Math.max(
          startY + Math.floor(pageContentPx * 0.72),
          idealEndY - 180,
        )
        const searchTo = Math.max(searchFrom + 1, idealEndY - 20)

        let bestRow = idealEndY
        let bestScore = Number.MAX_SAFE_INTEGER

        for (let row = searchFrom; row <= searchTo; row += 2) {
          const score = getInkScoreForRow(row)
          const distancePenalty = Math.abs(idealEndY - row) * 0.02
          const weightedScore = score + distancePenalty

          if (weightedScore < bestScore) {
            bestScore = weightedScore
            bestRow = row
          }
        }

        return Math.min(Math.max(bestRow, startY + 40), idealEndY)
      }

      let startY = 0
      let pageIndex = 0

      while (startY < canvas.height) {
        const remainingPx = canvas.height - startY
        let sliceHeightPx = Math.min(pageContentPx, remainingPx)

        if (remainingPx > pageContentPx) {
          const idealEndY = startY + pageContentPx
          const cleanEndY = findCleanBreakRow(startY, idealEndY)
          const adjustedHeight = cleanEndY - startY

          if (adjustedHeight > 0) {
            sliceHeightPx = adjustedHeight
          }
        }

        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = canvas.width
        sliceCanvas.height = sliceHeightPx
        const sliceContext = sliceCanvas.getContext('2d')

        if (!sliceContext) {
          throw new Error('Unable to generate PDF slice canvas context.')
        }

        sliceContext.drawImage(
          canvas,
          0,
          startY,
          canvas.width,
          sliceHeightPx,
          0,
          0,
          canvas.width,
          sliceHeightPx,
        )

        const sliceImageData = sliceCanvas.toDataURL('image/png')
        const sliceHeightPt = (sliceHeightPx * contentWidth) / canvas.width

        if (pageIndex > 0) {
          doc.addPage()
        }

        doc.addImage(
          sliceImageData,
          'PNG',
          margin,
          margin,
          contentWidth,
          sliceHeightPt,
          undefined,
          'FAST',
        )

        startY += sliceHeightPx
        pageIndex += 1
      }

      doc.save(`${safeName || 'submission'}-${report.id ?? 'report'}.pdf`)
    } catch (error) {
      setAdminError(getErrorMessage(error, 'Unable to generate PDF right now.'))
    } finally {
      clone.remove()
    }
  }

  const openAdminView = () => {
    if (isAdminAuthenticated) {
      setView('admin')
      return
    }

    setAdminAuthError('')
    setIsAdminAuthModalOpen(true)
  }

  const handleAdminLogin = async () => {
    setAdminAuthError('')

    const username = adminUsername.trim()
    const password = adminPassword

    if (!username || !password) {
      setAdminAuthError('Please enter admin username and password.')
      return
    }

    if (!isSupabaseReady) {
      setAdminAuthError(getSupabaseMissingMessage())
      return
    }

    setAdminAuthLoading(true)

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.')
      }

      const { data, error } = await supabase
        .from(ADMIN_USERS_TABLE)
        .select('username, password')
        .eq('username', username)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (!data || data.password !== password) {
        setAdminAuthError('Invalid admin credentials.')
        return
      }

      setAdminSession({ username, password })
      setIsAdminAuthenticated(true)
      setIsAdminAuthModalOpen(false)
      setAdminPassword('')
      setView('admin')
    } catch (error) {
      setAdminAuthError(getErrorMessage(error, 'Unable to login as admin.'))
    } finally {
      setAdminAuthLoading(false)
    }
  }

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false)
    setIsAdminAuthModalOpen(false)
    setAdminUsername('')
    setAdminPassword('')
    setAdminSession(null)
    setAdminAuthError('')
    setView('form')
    setSelectedReport(null)
  }

  const handleDeleteReport = async (reportId?: string) => {
    if (!reportId || !isAdminAuthenticated) {
      return
    }

    const shouldDelete = window.confirm(
      'Are you sure you want to permanently delete this response?',
    )

    if (!shouldDelete) {
      return
    }

    if (!isSupabaseReady) {
      setAdminError(getSupabaseMissingMessage())
      return
    }

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.')
      }

      if (!adminSession?.username || !adminSession.password) {
        throw new Error('Admin session expired. Please login again.')
      }

      const { data, error } = await supabase.rpc('delete_case_report_as_admin', {
        p_report_id: reportId,
        p_username: adminSession.username,
        p_password: adminSession.password,
      })

      if (error) {
        throw error
      }

      if (!data) {
        throw new Error(
          'Delete was not applied. Please verify admin credentials and Supabase function setup.',
        )
      }

      setReports((prev) => prev.filter((report) => report.id !== reportId))
      setSelectedReport((prev) => (prev?.id === reportId ? null : prev))
      await fetchReports()
    } catch (error) {
      setAdminError(getErrorMessage(error, 'Unable to delete submission.'))
    }
  }

  const resetAdminFilters = () => {
    setSearchKeyword('')
    setOfficeFilter('')
    setCategoryFilter('')
    setDateFromFilter('')
    setDateToFilter('')
  }

  const applyCategoryMode = (mode: CategoryMode) => {
    const titles =
      mode === 'system'
        ? getTopCategoryTitlesForOffice(departmentValue)
        : getCustomCategoryTitles()

    setCategoryMode(mode)
    setCustomCategoryError('')
    setFormData((prev) => ({
      ...prev,
      categories: createCategoryEntries(titles),
    }))
    setIsCategoryModeModalOpen(false)
    setStep(2)
  }

  const handleAcceptTerms = () => {
    if (!hasAgreedToTerms) {
      return
    }

    setIsTermsModalOpen(false)
  }

  const handleAcceptCookies = () => {
    try {
      localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted')
    } catch {
      // noop
    }

    setHasAcceptedCookies(true)
    setIsCookieBannerOpen(false)
  }

  const renderCategoryGroup = (start: number, end: number) => (
    <div className="category-grid">
      {formData.categories.slice(start, end).map((category, index) => {
        const categoryIndex = start + index
        return (
          <section className="category-card" key={`category-${categoryIndex}`}>
            <header>
              <h3>Top {categoryIndex + 1} Category</h3>
              <div className="category-header-actions">
                {categoryMode === 'custom' ? (
                  <input
                    className="title-input"
                    type="text"
                    value={category.title}
                    onChange={(event) =>
                      handleCategoryChange(
                        categoryIndex,
                        'title',
                        event.target.value,
                      )
                    }
                    placeholder={`Custom Category ${categoryIndex + 1}`}
                  />
                ) : (
                  <span className="tag">{category.title}</span>
                )}
                <button
                  type="button"
                  className="category-remove-btn"
                  onClick={() => handleRemoveCategory(categoryIndex)}
                  aria-label={`Remove Top ${categoryIndex + 1} Category`}
                  title="Remove category"
                  disabled={formData.categories.length <= MIN_CATEGORIES}
                >
                  <X size={13} />
                </button>
              </div>
            </header>
            <div className="grid">
              <label className="field">
                <span>Expected Processing Time (in days)</span>
                <input
                  type="number"
                  min="0"
                  value={category.committedDays}
                  onChange={(event) =>
                    handleCategoryChange(
                      categoryIndex,
                      'committedDays',
                      event.target.value,
                    )
                  }
                  placeholder="Example: 3 days"
                />
              </label>
              <label className="field">
                <span>Actual Time Taken (in days)</span>
                <input
                  type="number"
                  min="0"
                  value={category.actualDays}
                  onChange={(event) =>
                    handleCategoryChange(
                      categoryIndex,
                      'actualDays',
                      event.target.value,
                    )
                  }
                  placeholder="Example: 4 days"
                />
              </label>
            </div>
            <label className="field">
              <span>If there was a delay, what caused it?</span>
              <textarea
                rows={3}
                value={category.reason}
                onChange={(event) =>
                  handleCategoryChange(
                    categoryIndex,
                    'reason',
                    event.target.value,
                  )
                }
                placeholder="Please briefly explain what caused the delay"
              />
            </label>
            <label className="field">
              <span>What support do you need from CMO?</span>
              <textarea
                rows={3}
                value={category.cmoHelp}
                onChange={(event) =>
                  handleCategoryChange(
                    categoryIndex,
                    'cmoHelp',
                    event.target.value,
                  )
                }
                placeholder="Please describe what assistance from CMO would help"
              />
            </label>
          </section>
        )
      })}
    </div>
  )

  return (
    <div className="app">
      {isTermsModalOpen && (
        <div className="terms-overlay" role="dialog" aria-modal="true">
          <div className="terms-card">
            <h2>Terms and Conditions</h2>
            <p className="subtext terms-text">
              By continuing with this form, you confirm that all information you
              provide is true, accurate, and submitted in good faith. You agree
              that false, misleading, or incomplete entries may affect review,
              routing, and processing of your concern.
            </p>
            <p className="subtext terms-text">
              You also understand that submitted data may be used by the City
              Government for official case handling, reporting, and service
              improvement. Please ensure details are honest and complete before
              proceeding.
            </p>
            <label className="terms-check">
              <input
                type="checkbox"
                checked={hasAgreedToTerms}
                onChange={(event) => setHasAgreedToTerms(event.target.checked)}
              />
              <span>
                I confirm that I will provide true and honest information.
              </span>
            </label>
            <div className="terms-actions">
              <button
                className={hasAgreedToTerms ? 'btn terms-accept ready' : 'btn terms-accept'}
                onClick={handleAcceptTerms}
                disabled={!hasAgreedToTerms}
              >
                Accept and Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="app-header no-print">
        <div>
          <p className="eyebrow">MyNaga Representatives</p>
          <h1>Case Resolution Form</h1>
          <p className="subtext">
            Powered by Ratbridge
          </p>
        </div>
        <nav className="tabs">
          <button
            className={view === 'form' ? 'tab active' : 'tab'}
            onClick={() => setView('form')}
          >
            Form
          </button>
          <button
            className={view === 'admin' ? 'tab active' : 'tab'}
            onClick={openAdminView}
          >
            Admin
          </button>
          <button
            className={view === 'analytics' ? 'tab active' : 'tab'}
            onClick={() => setView('analytics')}
          >
            Analytics
          </button>
        </nav>
      </header>

      {view === 'form' && (
        <section className="card">
          <div className="progress-wrap no-print">
            <div className="progress-meta">
              <span>Step {step} of {totalSteps}</span>
              <span>{stepLabels[step - 1] ?? stepLabels[0]}</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{ width: `${(step / totalSteps) * 100}%` }}
              />
            </div>
          </div>
          <div className="stepper no-print">
            {stepLabels.map((label, index) => (
              <div
                className={
                  step === index + 1 ? 'step active' : 'step inactive'
                }
                key={label}
              >
                <span>{index + 1}</span>
                <p>{label}</p>
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="section">
              <h2>Personal Information</h2>
              <p className="subtext section-note">
                Please provide your basic information. Fields marked required
                must be filled in. Top categories on the next pages are based on
                your selected department/office.
              </p>
              <div className="grid">
                <label className="field">
                  <span>First Name</span>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(event) =>
                      handleFieldChange('firstName', event.target.value)
                    }
                    placeholder="Juan"
                    required
                  />
                </label>
                <label className="field">
                  <span>Middle Name</span>
                  <input
                    type="text"
                    value={formData.middleName}
                    onChange={(event) =>
                      handleFieldChange('middleName', event.target.value)
                    }
                    placeholder="Santos"
                    required
                  />
                </label>
                <label className="field">
                  <span>Last Name</span>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(event) =>
                      handleFieldChange('lastName', event.target.value)
                    }
                    placeholder="Dela Cruz"
                    required
                  />
                </label>
                <label className="field">
                  <span>Name Suffix (Optional)</span>
                  <input
                    type="text"
                    value={formData.nameSuffix}
                    onChange={(event) =>
                      handleFieldChange('nameSuffix', event.target.value)
                    }
                    placeholder="Jr., Sr., III"
                  />
                </label>
              </div>
              <div className="grid">
                <label className="field">
                  <span>Phone Number</span>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(event) =>
                      handleFieldChange('phone', event.target.value)
                    }
                    placeholder="e.g. 0917 000 0000"
                    required
                  />
                </label>
                <label className="field">
                  <span>Email Address</span>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(event) =>
                      handleFieldChange('email', event.target.value)
                    }
                    placeholder="name@email.com"
                    required
                  />
                </label>
                <label className="field">
                  <span>Department / Office</span>
                  <input
                    list="departments"
                    value={formData.department}
                    onChange={(event) =>
                      handleFieldChange('department', event.target.value)
                    }
                    placeholder="PSO"
                    required
                  />
                  <datalist id="departments">
                    {officeTopCategories.officeList.map((office) => (
                      <option key={office} value={office} />
                    ))}
                  </datalist>
                </label>
              </div>
              {!isPersonalValid && (
                <p className="helper">Complete all required fields to continue.</p>
              )}
            </div>
          )}

          {isCustomMode && step === 2 && (
            <div className="section">
              <h2>Set Your Top 10 Custom Categories</h2>
              <p className="subtext">
                Enter category names first, then continue to fill details in
                pages 2.1 and 2.2.
              </p>
              <div className="custom-category-meta">
                <span className="pill">Checklist</span>
                <span>
                  {completedCustomCategories}/{formData.categories.length} categories completed
                </span>
                <button
                  type="button"
                  className="btn secondary btn-inline"
                  onClick={handleAddCategory}
                  disabled={formData.categories.length >= MAX_CATEGORIES}
                >
                  <Plus size={14} /> Add Category
                </button>
              </div>
              <div className="section-divider" />
              <div className="custom-category-grid">
                {formData.categories.map((category, index) => (
                  <div className="custom-category-item" key={`custom-name-${index}`}>
                    <div className="custom-category-item-head">
                      <span className="custom-number">{index + 1}</span>
                      <span className="custom-label">Top {index + 1} Category</span>
                      <button
                        type="button"
                        className="category-remove-btn"
                        onClick={() => handleRemoveCategory(index)}
                        aria-label={`Remove Top ${index + 1} Category`}
                        title="Remove category"
                        disabled={formData.categories.length <= MIN_CATEGORIES}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <label className="field compact">
                      <span>Category Name</span>
                      <input
                        type="text"
                        value={category.title}
                        onChange={(event) =>
                          handleCategoryChange(
                            index,
                            'title',
                            event.target.value,
                          )
                        }
                        placeholder={`Custom Category ${index + 1}`}
                      />
                    </label>
                  </div>
                ))}
              </div>
              {customCategoryError && (
                <p className="alert inline-alert">{customCategoryError}</p>
              )}
              {categoryCountError && (
                <p className="alert inline-alert">{categoryCountError}</p>
              )}
            </div>
          )}

          {step === detailsStepOne && (
            <div className="section">
              <h2>{selectedOfficeLabel}: Top Categories of Cases (1 - 5)</h2>
              <p className="subtext">
                {categoryMode === 'custom'
                  ? 'Enter your own top category names and resolution details.'
                  : `These are the top categories for ${selectedOfficeLabel} based on your spreadsheet data.`}
              </p>
              <span className="mode-badge">
                {categoryMode === 'custom' ? 'Custom Category' : 'System Based'}
              </span>
              <div className="category-controls no-print">
                <span className="helper">
                  Categories: {formData.categories.length} (min {MIN_CATEGORIES}, max {MAX_CATEGORIES})
                </span>
                <button
                  type="button"
                  className="btn secondary btn-inline"
                  onClick={handleAddCategory}
                  disabled={formData.categories.length >= MAX_CATEGORIES}
                >
                  <Plus size={14} /> Add Category
                </button>
              </div>
              <div className="section-divider" />
              {renderCategoryGroup(0, 5)}
            </div>
          )}

          {hasSecondDetailsPage && step === detailsStepTwo && (
            <div className="section">
              <h2>{selectedOfficeLabel}: Top Categories of Cases (6 - 10)</h2>
              <p className="subtext">
                {categoryMode === 'custom'
                  ? 'Continue adding your custom categories and details.'
                  : 'Continue filling out the remaining office-specific categories.'}
              </p>
              <span className="mode-badge">
                {categoryMode === 'custom' ? 'Custom Category' : 'System Based'}
              </span>
              <div className="category-controls no-print">
                <span className="helper">
                  Categories: {formData.categories.length} (min {MIN_CATEGORIES}, max {MAX_CATEGORIES})
                </span>
                <button
                  type="button"
                  className="btn secondary btn-inline"
                  onClick={handleAddCategory}
                  disabled={formData.categories.length >= MAX_CATEGORIES}
                >
                  <Plus size={14} /> Add Category
                </button>
              </div>
              <div className="section-divider" />
              {renderCategoryGroup(5, 10)}
            </div>
          )}

          <div className="actions no-print">
            {step > 1 && (
              <button className="btn ghost" onClick={handleBack}>
                Back
              </button>
            )}
            {step < totalSteps ? (
              <button
                className="btn"
                onClick={handleNext}
                disabled={step === 1 && !isPersonalValid}
              >
                Continue
              </button>
            ) : (
              <button
                className="btn"
                onClick={handleSubmit}
                disabled={submitting || !isPersonalValid}
              >
                {submitting ? 'Submitting...' : 'Submit Form'}
              </button>
            )}
          </div>

          {submitError && <p className="alert">{submitError}</p>}
          {categoryValidationError && <p className="alert">{categoryValidationError}</p>}
          {categoryCountError && <p className="alert">{categoryCountError}</p>}
          {submitSuccess && (
            <div className="success">
              <p>Form submitted successfully.</p>
              <button className="btn secondary" onClick={handlePrint}>
                Print this response
              </button>
            </div>
          )}

          {submitSuccess && (
            <div className="print-area response-print-area">
              <div className="detail-header">
                <div>
                  <h3>Case Resolution Form Submission</h3>
                  <p className="subtext">
                    {submitSuccess.created_at
                      ? new Date(submitSuccess.created_at).toLocaleString()
                      : ''}
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="report-table summary-table">
                  <tbody>
                    <tr>
                      <th>Name</th>
                      <td>{formatFullName(submitSuccess)}</td>
                      <th>Phone</th>
                      <td>{submitSuccess.phone || '—'}</td>
                    </tr>
                    <tr>
                      <th>Email Address</th>
                      <td>{submitSuccess.email || '—'}</td>
                      <th>Department</th>
                      <td>{submitSuccess.department || '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {submitSuccess.categories?.length > 0 && (
                <div className="detail-categories">
                  <p className="helper print-category-count">
                    Total categories included: {submitSuccess.categories.length}
                  </p>
                  <div className="table-wrap">
                    <table className="report-table categories-table">
                      <thead>
                        <tr>
                          <th>Top #</th>
                          <th>Category</th>
                          <th>Expected (Days)</th>
                          <th>Actual (Days)</th>
                          <th>Delay Cause</th>
                          <th>Support Requested from CMO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submitSuccess.categories.map((category, index) => (
                          <tr key={`${category.title}-${index}`}>
                            <td>{index + 1}</td>
                            <td>{category.title || '—'}</td>
                            <td>{category.committedDays || '—'}</td>
                            <td>{category.actualDays || '—'}</td>
                            <td>{category.reason || '—'}</td>
                            <td>{category.cmoHelp || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {isCategoryModeModalOpen && (
            <div className="modal-overlay no-print" role="dialog" aria-modal="true">
              <div className="modal-card">
                <h3>Choose Category Source</h3>
                <p className="subtext">
                  Description: Choose how you want to set the categories for
                  discussion. You may use the suggested categories based on
                  current reports, or add your own categories if you already
                  have specific topics to raise.
                </p>
                <div className="modal-actions">
                  <button
                    className="btn secondary modal-option"
                    onClick={() => applyCategoryMode('custom')}
                  >
                    <span className="modal-option-icon" aria-hidden="true">
                      <Sparkles size={22} />
                    </span>
                    <span className="modal-option-text">
                      <strong>Add your own categories</strong>
                      <small>Define your own Top 10 categories first</small>
                    </span>
                  </button>
                  <button
                    className="btn modal-option"
                    onClick={() => applyCategoryMode('system')}
                  >
                    <span className="modal-option-icon" aria-hidden="true">
                      <ListOrdered size={22} />
                    </span>
                    <span className="modal-option-text">
                      <strong>Use suggested categories</strong>
                      <small>Use Top 10 categories from spreadsheet source</small>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {view === 'admin' && (
        <section className="card">
          <div className="admin-header no-print">
            <div>
              <h2>Admin View</h2>
              <p className="subtext">
                Review submissions and print reports.
              </p>
            </div>
            <div className="admin-header-actions">
              <button
                className="btn secondary"
                onClick={fetchReports}
                disabled={loadingReports}
              >
                {loadingReports ? 'Refreshing...' : 'Refresh'}
              </button>
              <button className="btn ghost" onClick={handleAdminLogout}>
                Logout
              </button>
            </div>
          </div>
          <div className="admin-filters no-print">
            <label className="field compact">
              <span>Search keyword</span>
              <input
                type="text"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder="Name, email, reason, CMO help..."
              />
            </label>
            <label className="field compact">
              <span>Office</span>
              <select
                value={officeFilter}
                onChange={(event) => setOfficeFilter(event.target.value)}
              >
                <option value="">All offices</option>
                {officeFilterOptions.map((office) => (
                  <option key={office} value={office}>
                    {office}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact">
              <span>Category</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="">All categories</option>
                {categoryFilterOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact">
              <span>Date from</span>
              <input
                type="date"
                value={dateFromFilter}
                onChange={(event) => setDateFromFilter(event.target.value)}
              />
            </label>
            <label className="field compact">
              <span>Date to</span>
              <input
                type="date"
                value={dateToFilter}
                onChange={(event) => setDateToFilter(event.target.value)}
              />
            </label>
            <div className="admin-filter-actions">
              <button className="btn ghost" onClick={resetAdminFilters}>
                Clear Filters
              </button>
            </div>
          </div>
          {adminError && <p className="alert">{adminError}</p>}
          {!adminError && reports.length === 0 && (
            <p className="helper">No submissions yet.</p>
          )}
          {!adminError && reports.length > 0 && filteredReports.length === 0 && (
            <p className="helper">No submissions match the selected filters.</p>
          )}
          <div className="admin-grid">
            <div className="admin-list">
              {filteredReports.map((report) => (
                <div
                  key={report.id}
                  className={
                    selectedReport?.id === report.id
                      ? 'list-card active'
                      : 'list-card'
                  }
                >
                  <button
                    className="list-card-main"
                    onClick={() => setSelectedReport(report)}
                  >
                    <div>
                      <h3>{formatFullName(report)}</h3>
                      <p>{report.department}</p>
                    </div>
                    <span>
                      {report.created_at
                        ? new Date(report.created_at).toLocaleString()
                        : 'Pending'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="list-card-delete no-print"
                    onClick={() => handleDeleteReport(report.id)}
                    title="Delete response"
                    aria-label="Delete response"
                    disabled={!report.id || !isAdminAuthenticated}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="admin-detail">
              {selectedReport ? (
                <div className="print-area" ref={adminPrintAreaRef}>
                  <div className="detail-header">
                    <div>
                      <h3>Submission Details</h3>
                      <p className="subtext">
                        {selectedReport.created_at
                          ? new Date(
                              selectedReport.created_at,
                            ).toLocaleString()
                          : ''}
                      </p>
                    </div>
                    <div className="admin-header-actions no-print">
                      <button
                        className="btn secondary"
                        onClick={() => handleDownloadSubmission(selectedReport)}
                      >
                        Download PDF
                      </button>
                      <button className="btn" onClick={handlePrint}>
                        Print
                      </button>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="report-table summary-table">
                      <tbody>
                        <tr>
                          <th>Name</th>
                          <td>{formatFullName(selectedReport)}</td>
                          <th>Phone</th>
                          <td>{selectedReport.phone || '—'}</td>
                        </tr>
                        <tr>
                          <th>Email Address</th>
                          <td>{selectedReport.email || '—'}</td>
                          <th>Department</th>
                          <td>{selectedReport.department || '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {selectedReport.categories?.length > 0 && (
                    <div className="detail-categories">
                      <p className="helper print-category-count">
                        Total categories included: {selectedReport.categories.length}
                      </p>
                      <div className="table-wrap">
                        <table className="report-table categories-table">
                          <thead>
                            <tr>
                              <th>Top #</th>
                              <th>Category</th>
                              <th>Expected (Days)</th>
                              <th>Actual (Days)</th>
                              <th>Delay Cause</th>
                              <th>Support Requested from CMO</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedReport.categories.map((category, index) => (
                              <tr key={`${category.title}-${index}`}>
                                <td>{index + 1}</td>
                                <td>{category.title || '—'}</td>
                                <td>{category.committedDays || '—'}</td>
                                <td>{category.actualDays || '—'}</td>
                                <td>{category.reason || '—'}</td>
                                <td>{category.cmoHelp || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="helper">Select a submission to view details.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {view === 'analytics' && (
        <section className="card">
          <div className="admin-header">
            <div>
              <h2>Office Analytics</h2>
              <p className="subtext">
                Top specific categories per office based on spreadsheet reports.
              </p>
            </div>
            <span className="pill">
              {officeTopCategories.overall.totalReports} total reports
            </span>
          </div>

          <div className="analytics-grid">
            <div className="analytics-card">
              <h3>Overall Top Categories</h3>
              <ul>
                {officeTopCategories.overall.categories.map((category) => (
                  <li key={category.name}>
                    <span>{category.name}</span>
                    <strong>{category.count}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <div className="analytics-card full">
              <h3>Top Categories by Office</h3>
              <div className="office-grid">
                {officeTopCategories.offices.map((office) => (
                  <div className="office-card" key={office.office}>
                    <div className="office-header">
                      <h4>{office.office}</h4>
                      <span className="pill">{office.totalReports}</span>
                    </div>
                    <ul>
                      {office.categories.map((category) => (
                        <li key={category.name}>
                          <span>{category.name}</span>
                          <strong>{category.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {isCookieBannerOpen && (
        <div className="cookie-banner no-print" role="dialog" aria-live="polite">
          <div className="cookie-banner-content">
            <strong>Cookie & Offline Draft Saving</strong>
            <p>
              Please accept cookies/local storage so your form draft stays saved
              in this browser, even when internet connection is lost.
            </p>
          </div>
          <button className="btn" onClick={handleAcceptCookies}>
            Accept Cookies
          </button>
        </div>
      )}

      {isAdminAuthModalOpen && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true">
          <div className="modal-card admin-auth-modal">
            <h3>Admin Login</h3>
            <p className="subtext">
              Enter your admin credentials to view and manage submissions.
              Credentials are verified against your Supabase `admin_users` table.
            </p>
            <div className="grid auth-grid">
              <label className="field">
                <span>Username</span>
                <input
                  type="text"
                  value={adminUsername}
                  onChange={(event) => setAdminUsername(event.target.value)}
                  placeholder="admin"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  placeholder="••••••••"
                />
              </label>
            </div>
            {adminAuthError && <p className="alert inline-alert">{adminAuthError}</p>}
            <div className="admin-auth-actions">
              <button
                className="btn ghost"
                onClick={() => setIsAdminAuthModalOpen(false)}
                disabled={adminAuthLoading}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleAdminLogin}
                disabled={adminAuthLoading}
              >
                {adminAuthLoading ? 'Signing in...' : 'Login as Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
