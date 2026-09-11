window.API = (function(){

  let seq = 0;

  const TOKEN_LOCAL =
    'hirmer_v72_token_local';

  const TOKEN_SESSION =
    'hirmer_v72_token_session';


  function sleep(ms){
    return new Promise(function(resolve){
      setTimeout(resolve, ms);
    });
  }


  function getToken(){
    return (
      localStorage.getItem(TOKEN_LOCAL) ||
      sessionStorage.getItem(TOKEN_SESSION) ||
      ''
    );
  }


  function hasToken(){
    return !!getToken();
  }


  function storeToken(token, remember){
    if(remember){
      localStorage.setItem(TOKEN_LOCAL, token);
      sessionStorage.removeItem(TOKEN_SESSION);
    }else{
      sessionStorage.setItem(TOKEN_SESSION, token);
      localStorage.removeItem(TOKEN_LOCAL);
    }
  }


  function logoutLocal(){
    localStorage.removeItem(TOKEN_LOCAL);
    sessionStorage.removeItem(TOKEN_SESSION);
  }


  function singleCall(
    action,
    args,
    timeoutMs,
    extraParams
  ){
    args = args || [];
    timeoutMs = timeoutMs || 15000;
    extraParams = extraParams || {};

    return new Promise(function(resolve, reject){

      const cb =
        "__hh_cb_" +
        Date.now() +
        "_" +
        (++seq);

      const script =
        document.createElement("script");

      const base =
        window.HEIZOEL_HIRMER_CONFIG.API_URL;

      const params =
        Object.assign(
          {},
          extraParams,
          {
            v72api: "1",
            action: action,
            callback: cb,
            _: Date.now()
          }
        );

      if(
        action !== 'login'
      ){
        params.token =
          getToken();
      }

      if(
        args &&
        args.length
      ){
        params.args =
          JSON.stringify(args);
      }

      const query =
        new URLSearchParams(
          params
        );

      let finished = false;

      const timer =
        setTimeout(
          function(){
            if(finished) return;

            finished = true;
            cleanup();

            reject(
              new Error(
                "Zeitüberschreitung beim Laden."
              )
            );
          },
          timeoutMs
        );

      window[cb] =
        function(response){

          if(finished) return;

          finished = true;

          clearTimeout(timer);
          cleanup();

          if(
            response &&
            response.ok !== false
          ){
            resolve(
              response.data
            );
          }else{
            reject(
              new Error(
                (
                  response &&
                  response.error
                ) ||
                "Unbekannter Serverfehler"
              )
            );
          }
        };


      function cleanup(){
        try{
          delete window[cb];
        }catch(e){
          window[cb] = undefined;
        }

        if(
          script.parentNode
        ){
          script.parentNode.removeChild(
            script
          );
        }
      }


      script.onerror =
        function(){

          if(finished) return;

          finished = true;

          clearTimeout(timer);
          cleanup();

          reject(
            new Error(
              "Verbindung zum Datenserver fehlgeschlagen."
            )
          );
        };


      script.src =
        base +
        (
          base.indexOf("?") >= 0
            ? "&"
            : "?"
        ) +
        query.toString();

      document.head.appendChild(
        script
      );
    });
  }



  function fireWrite(action, args){
    args = args || [];

    return new Promise(function(resolve, reject){
      const cb = "__hh_fire_" + Date.now() + "_" + (++seq);
      const script = document.createElement("script");
      const base = window.HEIZOEL_HIRMER_CONFIG.API_URL;
      const token = getToken();

      if(!token){
        reject(new Error("Sitzung ist ungültig. Bitte neu anmelden."));
        return;
      }

      const params = {
        v72api: "1",
        action: action,
        callback: cb,
        token: token,
        _: Date.now()
      };

      if(args.length){
        params.args = JSON.stringify(args);
      }

      const query = new URLSearchParams(params);

      let cleaned = false;

      function cleanup(){
        if(cleaned) return;
        cleaned = true;
        try{ delete window[cb]; }catch(e){ window[cb] = undefined; }
        if(script.parentNode) script.parentNode.removeChild(script);
      }

      // Späte Apps-Script-Antwort bewusst ignorieren.
      window[cb] = function(){ cleanup(); };

      // Auch bei script.onerror kann der Server-Schreibvorgang bereits
      // erfolgt sein. Entscheidend ist der anschließende Kontroll-Read.
      script.onerror = function(){};

      script.src =
        base +
        (base.indexOf("?") >= 0 ? "&" : "?") +
        query.toString();

      document.head.appendChild(script);

      // Nicht auf den langsamen Callback warten.
      setTimeout(function(){
        resolve({started:true});
      }, 50);

      setTimeout(cleanup, 60000);
    });
  }


  async function call(
    action,
    args,
    options
  ){
    options = options || {};

    const retries =
      typeof options.retries === 'number'
        ? options.retries
        : 0;

    const timeoutMs =
      options.timeoutMs ||
      15000;

    const delays =
      options.delays ||
      [1000,2000,4000];

    const extraParams =
      options.extraParams ||
      {};

    let lastError;

    for(
      let attempt = 0;
      attempt <= retries;
      attempt++
    ){
      try{
        return await singleCall(
          action,
          args,
          timeoutMs,
          extraParams
        );
      }catch(err){
        lastError = err;

        if(
          /Sitzung/i.test(
            err.message || ''
          )
        ){
          logoutLocal();
          throw err;
        }

        if(
          attempt >= retries
        ){
          break;
        }

        await sleep(
          delays[
            Math.min(
              attempt,
              delays.length - 1
            )
          ] ||
          1000
        );
      }
    }

    throw (
      lastError ||
      new Error(
        "Daten konnten nicht geladen werden."
      )
    );
  }


  async function login(
    passwordHash,
    remember
  ){
    const data =
      await call(
        'login',
        [],
        {
          retries: 0,
          timeoutMs: 12000,
          extraParams: {
            passwordHash: passwordHash,
            remember:
              remember
                ? 'true'
                : 'false'
          }
        }
      );

    if(
      !data ||
      !data.token
    ){
      throw new Error(
        'Anmeldung fehlgeschlagen.'
      );
    }

    storeToken(
      data.token,
      remember
    );

    return data;
  }


  return {
    call: call,

    login: login,

    hasToken: hasToken,

    logoutLocal: logoutLocal,

    read: function(action, args){
      return call(
        action,
        args,
        {
          retries: 3,
          timeoutMs: 12000,
          delays: [1000,2000,4000]
        }
      );
    },

    readOnce: function(action, args, timeoutMs){
      return call(
        action,
        args,
        {
          retries: 0,
          timeoutMs: timeoutMs || 25000
        }
      );
    },

    write: function(action, args){
      return call(
        action,
        args,
        {
          retries: 0,
          timeoutMs: 18000
        }
      );
    },

    fireWrite: function(action, args){
      return fireWrite(action, args);
    }
  };

})();
