const express = require('express');
const app = express();

app.get('/test', (req, res) => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(req), 'query') || 
                     Object.getOwnPropertyDescriptor(req, 'query');
  console.log('Descriptor for req.query:', descriptor);
  res.send(descriptor);
});

app.listen(5000, () => {
  console.log('Diagnostic server on 5001');
});
