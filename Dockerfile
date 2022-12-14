FROM node:16-alpine

# Create app directory
WORKDIR /app
COPY . /app
RUN npm install

CMD [ "npm", "start" ]