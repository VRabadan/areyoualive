FROM ubuntu:latest

# Create app directory
RUN apt-get update
RUN apt install -y curl
RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
RUN apt-get install -y git
RUN apt-get install -y vim
RUN git clone https://github.com/infely/mngr
RUN npm i -g mngr

ENTRYPOINT ["tail", "-f", "/dev/null"]