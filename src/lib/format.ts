// Единая локаль интерфейса - en-GB (24-часовой формат времени, день/месяц/год),
// валюта - UAH. Раздел "Язык" в CLAUDE.md: числа, деньги и даты форматируются
// только здесь, а не напрямую в компонентах.

const moneyFormatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'UAH',
});

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

export function formatMoney(value: number): string {
    return moneyFormatter.format(value);
}

export function formatDate(value: string | Date): string {
    return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
    return dateTimeFormatter.format(new Date(value));
}
