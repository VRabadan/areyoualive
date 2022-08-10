FROM node:16

# Create app directory
WORKDIR /app
COPY . /app
RUN npm install

CMD [ "npm", "start" ]