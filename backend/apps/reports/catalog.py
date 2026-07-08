PERIOD_OPTIONS = [
    {"value": "hours", "label": "По часам"},
    {"value": "days", "label": "По дням"},
    {"value": "weeks", "label": "По неделям"},
    {"value": "months", "label": "По месяцам"},
]


REPORT_SOURCES = [
    {
        "id": "lead-default",
        "type": "lead",
        "entityTypeId": 1,
        "categoryId": None,
        "title": "Воронка лидов",
        "sourceLabel": "Лиды",
        "isAvailable": True,
    },
    {
        "id": "deal-sales",
        "type": "deal",
        "entityTypeId": 2,
        "categoryId": 0,
        "title": "Воронка продажи",
        "sourceLabel": "Воронка продажи",
        "isAvailable": True,
    },
    {
        "id": "smart-production",
        "type": "smartProcess",
        "entityTypeId": 128,
        "categoryId": 0,
        "title": "Воронка производство",
        "sourceLabel": "Воронка производство",
        "isAvailable": True,
    },
    {
        "id": "invoice-default",
        "type": "invoice",
        "entityTypeId": 31,
        "categoryId": None,
        "title": "Счета",
        "sourceLabel": "Счета",
        "isAvailable": True,
    },
    {
        "id": "telephony-default",
        "type": "telephony",
        "entityTypeId": None,
        "categoryId": None,
        "title": "Телефония",
        "sourceLabel": "Телефония",
        "isAvailable": True,
    },
    {
        "id": "activity-default",
        "type": "activity",
        "entityTypeId": None,
        "categoryId": None,
        "title": "Дела CRM",
        "sourceLabel": "Дела CRM",
        "isAvailable": True,
    },
    {
        "id": "quote-default",
        "type": "quote",
        "entityTypeId": None,
        "categoryId": None,
        "title": "Коммерческие предложения",
        "sourceLabel": "Коммерческие предложения",
        "isAvailable": True,
    },
    {
        "id": "company-default",
        "type": "company",
        "entityTypeId": 4,
        "categoryId": None,
        "title": "Компании",
        "sourceLabel": "Компании",
        "isAvailable": True,
    },
    {
        "id": "contact-default",
        "type": "contact",
        "entityTypeId": 3,
        "categoryId": None,
        "title": "Контакты",
        "sourceLabel": "Контакты",
        "isAvailable": True,
    },
    {
        "id": "task-default",
        "type": "task",
        "entityTypeId": None,
        "categoryId": None,
        "title": "Задачи",
        "sourceLabel": "Задачи",
        "isAvailable": True,
    },
    {
        "id": "crm-form-default",
        "type": "crm_form",
        "entityTypeId": None,
        "categoryId": None,
        "title": "CRM формы",
        "sourceLabel": "CRM формы",
        "isAvailable": True,
    },
]


METRICS = [
    {"id": "deals_created", "label": "Создано сделок", "type": "number", "base": 35},
    {"id": "deals_won", "label": "Успешных сделок", "type": "number", "base": 18},
    {"id": "deals_lost", "label": "Проигранных сделок", "type": "number", "base": 7},
    {"id": "deals_won_sum", "label": "Сумма успешных сделок", "type": "money", "base": 920000},
    {"id": "deals_lost_sum", "label": "Сумма проигранных сделок", "type": "money", "base": 260000},
    {"id": "deals_conversion", "label": "Конверсия сделок", "type": "percent", "base": 42},

    {"id": "leads_created", "label": "Создано лидов", "type": "number", "base": 78},
    {"id": "leads_quality", "label": "Качественных лидов", "type": "number", "base": 45},
    {"id": "leads_bad", "label": "Некачественных лидов", "type": "number", "base": 14},
    {"id": "leads_quality_sum", "label": "Сумма качественных лидов", "type": "money", "base": 610000},
    {"id": "leads_bad_sum", "label": "Сумма некачественных лидов", "type": "money", "base": 130000},
    {"id": "leads_conversion", "label": "Конверсия лидов", "type": "percent", "base": 58},

    {"id": "invoices_created", "label": "Создано счетов", "type": "number", "base": 28},
    {"id": "invoices_won", "label": "Успешных счетов", "type": "number", "base": 20},
    {"id": "invoices_lost", "label": "Проигранных счетов", "type": "number", "base": 6},
    {"id": "invoices_won_sum", "label": "Сумма успешных счетов", "type": "money", "base": 740000},
    {"id": "invoices_lost_sum", "label": "Сумма проигранных счетов", "type": "money", "base": 190000},
    {"id": "invoices_conversion", "label": "Конверсия счетов", "type": "percent", "base": 63},

    {"id": "quotes_created", "label": "Создано КП", "type": "number", "base": 24},
    {"id": "quotes_sent", "label": "Отправлено КП", "type": "number", "base": 18},
    {"id": "quotes_accepted", "label": "Принято КП", "type": "number", "base": 15},
    {"id": "quotes_declined", "label": "Отклонено КП", "type": "number", "base": 5},
    {"id": "quotes_accepted_sum", "label": "Сумма принятых КП", "type": "money", "base": 510000},
    {"id": "quotes_declined_sum", "label": "Сумма отклоненных КП", "type": "money", "base": 110000},
    {"id": "quotes_conversion", "label": "Конверсия КП", "type": "percent", "base": 61},

    {"id": "contracts_created", "label": "Создано договоров", "type": "number", "base": 18},
    {"id": "contracts_sent", "label": "Отправлено договоров", "type": "number", "base": 14},
    {"id": "contracts_signed", "label": "Подписано договоров", "type": "number", "base": 9},
    {"id": "contracts_failed", "label": "Отклонено договоров", "type": "number", "base": 3},
    {"id": "contracts_signed_sum", "label": "Сумма подписанных договоров", "type": "money", "base": 640000},
    {"id": "contracts_conversion", "label": "Конверсия договоров", "type": "percent", "base": 50},

    {"id": "companies_new", "label": "Новых компаний", "type": "number", "base": 19},
    {"id": "contacts_new", "label": "Новых контактов", "type": "number", "base": 48},

    {"id": "calls_total", "label": "Всего звонков", "type": "number", "base": 118},
    {"id": "calls_in", "label": "Входящих звонков", "type": "number", "base": 66},
    {"id": "calls_out", "label": "Исходящих звонков", "type": "number", "base": 52},
    {"id": "calls_out_success", "label": "Успешных исходящих звонков", "type": "number", "base": 31},
    {"id": "calls_missed", "label": "Пропущенных звонков", "type": "number", "base": 9},

    {"id": "messages_new", "label": "Новых сообщений", "type": "number", "base": 81},
    {"id": "messages_total", "label": "Всего сообщений", "type": "number", "base": 146},

    {"id": "email_in", "label": "Входящих писем", "type": "number", "base": 44},
    {"id": "email_out", "label": "Отправленных писем", "type": "number", "base": 39},

    {"id": "crm_forms", "label": "Заполнено CRM форм", "type": "number", "base": 17},

    {"id": "tasks_created", "label": "Создано задач", "type": "number", "base": 57},
    {"id": "tasks_done", "label": "Завершено задач", "type": "number", "base": 49},
    {"id": "tasks_overdue", "label": "Просрочено задач", "type": "number", "base": 8},

    {"id": "meetings_created", "label": "Назначено встреч", "type": "number", "base": 21},
    {"id": "activities_created", "label": "Создано дел", "type": "number", "base": 63},
    {"id": "activities_done", "label": "Выполнено дел", "type": "number", "base": 55},
    {"id": "activities_undone", "label": "Невыполнено дел", "type": "number", "base": 11},
]


METRIC_SECTIONS = [
    {
        "id": "deals",
        "label": "Сделки",
        "metricIds": [
            "deals_created",
            "deals_won",
            "deals_lost",
            "deals_won_sum",
            "deals_lost_sum",
            "deals_conversion",
        ],
    },
    {
        "id": "leads",
        "label": "Лиды",
        "metricIds": [
            "leads_created",
            "leads_quality",
            "leads_bad",
            "leads_quality_sum",
            "leads_bad_sum",
            "leads_conversion",
        ],
    },
    {
        "id": "invoices",
        "label": "Счета",
        "metricIds": [
            "invoices_created",
            "invoices_won",
            "invoices_lost",
            "invoices_won_sum",
            "invoices_lost_sum",
            "invoices_conversion",
        ],
    },
    {
        "id": "quotes",
        "label": "КП",
        "metricIds": [
            "quotes_created",
            "quotes_sent",
            "quotes_accepted",
            "quotes_declined",
            "quotes_accepted_sum",
            "quotes_declined_sum",
            "quotes_conversion",
        ],
    },
    {
        "id": "contracts",
        "label": "Договоры",
        "metricIds": [
            "contracts_created",
            "contracts_sent",
            "contracts_signed",
            "contracts_failed",
            "contracts_signed_sum",
            "contracts_conversion",
        ],
    },
    {
        "id": "companies",
        "label": "Компании и контакты",
        "metricIds": [
            "companies_new",
            "contacts_new",
        ],
    },
    {
        "id": "calls",
        "label": "Звонки",
        "metricIds": [
            "calls_total",
            "calls_in",
            "calls_out",
            "calls_out_success",
            "calls_missed",
        ],
    },
    {
        "id": "messages",
        "label": "Сообщения",
        "metricIds": [
            "messages_new",
            "messages_total",
        ],
    },
    {
        "id": "email",
        "label": "Письма",
        "metricIds": [
            "email_in",
            "email_out",
        ],
    },
    {
        "id": "crm_forms",
        "label": "CRM формы",
        "metricIds": [
            "crm_forms",
        ],
    },
    {
        "id": "tasks",
        "label": "Задачи",
        "metricIds": [
            "tasks_created",
            "tasks_done",
            "tasks_overdue",
        ],
    },
    {
        "id": "activities",
        "label": "Встречи и дела",
        "metricIds": [
            "meetings_created",
            "activities_created",
            "activities_done",
            "activities_undone",
        ],
    },
]
