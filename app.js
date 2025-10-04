const express = require('express')
const morgan = require('morgan')
const cors = require('cors')
const path = require('path')
const app = express()
const bodyParser1 = require('body-parser')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const limiter = rateLimit({ windowMs: 60 * 1000, max: 1500, keyGenerator: (req) => req.ip })

//routes
const suggestions = require('./suggestions.js')

app.set('view engine', 'ejs')
app.use(helmet())
app.use(bodyParser1.urlencoded({ extended: false }))
app.use(bodyParser1.json())
app.use(morgan('dev'))
app.use(express.static(path.join(__dirname, 'public')))
app.use(limiter)
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' ?
    ["https://pikme.tv", 'https://create.pikme.tv', 'https://quiz.pikme.tv', 'https://career-h072.onrender.com', 'https://saltiz.store'] :
    ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8081', 'http://localhost:8082', 'http://10.0.2.2:8081', 'http://127.0.0.1:8081', 'http://192.168.1.29'],
  credentials: true
}
app.use(cors(corsOptions))
app.use('/suggestions', suggestions)
app.get('/test', async (req, res) => {
  res.json({ message: 'Hello World' })
})

app.use((req, res, next) => {
  const error = new Error('pikmeTV - Not found')
  error.status = 404
  next(error)
})
app.use((error, req, res, next) => {
  if (error.status !== 404) console.log(error)
  res.status(error.status || 500)
  res.json({
    error: {
      mesage: error.mesage
    }
  })
})

module.exports = app 