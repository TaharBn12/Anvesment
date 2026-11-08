FROM node:22-alpine

WORKDIR /app

# تثبيت الاعتماديات أولاً (للاستفادة من الكاش)
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# نسخ الكود
COPY src/ ./src/
COPY scripts/ ./scripts/

# مجلد قاعدة البيانات (استخدم قرصاً دائماً إن توفر)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# خادم الإشعارات
EXPOSE 3000

CMD ["npm", "start"]
