import handler from './api/brain/brainRouter.js';
const req={method:'POST',body:{sessionId:'debug',text:'Chciałbym zamówić w pobliżu'},json:async function(){return this.body;}};
const res={status(code){this.statusCode=code;return this;},json(payload){console.log('response',this.statusCode,payload);return payload;}};
try{await handler(req,res);}catch(err){console.error('Unhandled error:',err);}
