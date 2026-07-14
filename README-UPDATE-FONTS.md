# uFont — обновление базы Google Fonts

Эти файлы нужно поместить в корень проекта `C:\code\uFont`, сохранив папку `scripts`.

Ожидаемая структура:

```text
C:\code\uFont\
├── .env
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── scripts\
│   └── update-google-fonts.mjs
└── data\
    └── fonts-cyrillic.json  ← создаётся автоматически
```

API-ключ хранится только в `.env`:

```text
GOOGLE_FONTS_API_KEY=ваш_ключ
```

Файл `.env` нельзя публиковать на GitHub.

## Проверка скрипта

```powershell
npm run check:generator
```

## Создание или обновление базы

```powershell
npm run update:fonts
```

Скрипт создаст `data\fonts-cyrillic.json`. В базу попадут семейства, для которых Google Fonts указывает подмножество `cyrillic` или `cyrillic-ext`.

Для каждого семейства сохраняются категория, подмножества, начертания, TTF-ссылки, variable-оси, Google-теги и ссылка на официальную страницу семейства.
