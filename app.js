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
const { suggestionRouter } = require('./routes/suggestions.js')

app.set('view engine', 'ejs')
app.use(helmet())
app.use(bodyParser1.urlencoded({ extended: false }))
app.use(bodyParser1.json())
app.use(morgan('dev'))
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    },
  })
)

app.use(limiter)
const corsOptions = {
  origin: ['https://berger-store-2.myshopify.com', 'https://myshopify.com', 'http://localhost:3000'],
  credentials: true
}
app.use(cors(corsOptions))
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
})
app.use('/suggestions', suggestionRouter)

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