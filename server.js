require('dotenv').config()
const http = require('http')
const app = require('./app')
const port = process.env.PORT || 3029
const server = http.createServer(app)

server.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})

fetch('https://melingoai-assignment.onrender.com/test')
        .then(res => res.json())
        .then(data => console.log(data))
        .catch(err => console.error(err))