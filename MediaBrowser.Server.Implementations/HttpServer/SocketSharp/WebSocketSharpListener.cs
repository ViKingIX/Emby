﻿using MediaBrowser.Common.Net;
using MediaBrowser.Model.Logging;
using ServiceStack;
using ServiceStack.Web;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using WebSocketSharp.Net;

namespace MediaBrowser.Server.Implementations.HttpServer.SocketSharp
{
    public class WebSocketSharpListener : IHttpListener
    {
        private HttpListener _listener;
        private readonly ManualResetEventSlim _listenForNextRequest = new ManualResetEventSlim(false);

        private readonly ILogger _logger;
        private readonly Action<string> _endpointListener;

        public WebSocketSharpListener(ILogger logger, Action<string> endpointListener)
        {
            _logger = logger;
            _endpointListener = endpointListener;
        }

        public Action<Exception, IRequest> ErrorHandler { get; set; }

        public Func<IHttpRequest, Uri, Task> RequestHandler { get; set; }

        public Action<WebSocketConnectEventArgs> WebSocketHandler { get; set; }

        public void Start(IEnumerable<string> urlPrefixes)
        {
            if (_listener == null)
                _listener = new HttpListener(new SocketSharpLogger(_logger));

            foreach (var prefix in urlPrefixes)
            {
                _logger.Info("Adding HttpListener prefix " + prefix);
                _listener.Prefixes.Add(prefix);
            }

            _listener.Start();

            Task.Factory.StartNew(Listen, TaskCreationOptions.LongRunning);
        }

        private bool IsListening
        {
            get { return _listener != null && _listener.IsListening; }
        }

        // Loop here to begin processing of new requests.
        private void Listen()
        {
            while (IsListening)
            {
                if (_listener == null) return;
                _listenForNextRequest.Reset();

                try
                {
                    _listener.BeginGetContext(ListenerCallback, _listener);
                    _listenForNextRequest.Wait();
                }
                catch (Exception ex)
                {
                    _logger.Error("Listen()", ex);
                    return;
                }
                if (_listener == null) return;
            }
        }

        // Handle the processing of a request in here.
        private void ListenerCallback(IAsyncResult asyncResult)
        {
            var listener = asyncResult.AsyncState as HttpListener;
            HttpListenerContext context;

            if (listener == null) return;
            var isListening = listener.IsListening;

            try
            {
                if (!isListening)
                {
                    _logger.Debug("Ignoring ListenerCallback() as HttpListener is no longer listening");
                    return;
                }
                // The EndGetContext() method, as with all Begin/End asynchronous methods in the .NET Framework,
                // blocks until there is a request to be processed or some type of data is available.
                context = listener.EndGetContext(asyncResult);
            }
            catch (Exception ex)
            {
                // You will get an exception when httpListener.Stop() is called
                // because there will be a thread stopped waiting on the .EndGetContext()
                // method, and again, that is just the way most Begin/End asynchronous
                // methods of the .NET Framework work.
                var errMsg = ex + ": " + IsListening;
                _logger.Warn(errMsg);
                return;
            }
            finally
            {
                _listenForNextRequest.Set();
            }

            Task.Factory.StartNew(() => InitTask(context));
        }

        private void InitTask(HttpListenerContext context)
        {
            try
            {
                var task = this.ProcessRequestAsync(context);
                task.ContinueWith(x => HandleError(x.Exception, context), TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.AttachedToParent);

                if (task.Status == TaskStatus.Created)
                {
                    task.RunSynchronously();
                }
            }
            catch (Exception ex)
            {
                HandleError(ex, context);
            }
        }

        private Task ProcessRequestAsync(HttpListenerContext context)
        {
            var request = context.Request;

            LogHttpRequest(request);

            if (request.IsWebSocketRequest)
            {
                ProcessWebSocketRequest(context);
                return Task.FromResult(true);
            }

            if (string.IsNullOrEmpty(context.Request.RawUrl))
                return ((object)null).AsTaskResult();

            var httpReq = GetRequest(context);

            return RequestHandler(httpReq, request.Url);
        }

        /// <summary>
        /// Logs the HTTP request.
        /// </summary>
        /// <param name="request">The request.</param>
        private void LogHttpRequest(HttpListenerRequest request)
        {
            var endpoint = request.LocalEndPoint;

            if (endpoint != null)
            {
                var address = endpoint.ToString();

                _endpointListener(address);
            }

            LogRequest(_logger, request);
        }

        private void ProcessWebSocketRequest(HttpListenerContext ctx)
        {
            try
            {
                var webSocketContext = ctx.AcceptWebSocket(null);

                if (WebSocketHandler != null)
                {
                    WebSocketHandler(new WebSocketConnectEventArgs
                    {
                        WebSocket = new SharpWebSocket(webSocketContext.WebSocket, _logger),
                        Endpoint = ctx.Request.RemoteEndPoint.ToString()
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.ErrorException("AcceptWebSocketAsync error", ex);
                ctx.Response.StatusCode = 500;
                ctx.Response.Close();
            }
        }

        private IHttpRequest GetRequest(HttpListenerContext httpContext)
        {
            var operationName = httpContext.Request.GetOperationName();

            var req = new WebSocketSharpRequest(httpContext, operationName, RequestAttributes.None, _logger);
            req.RequestAttributes = req.GetAttributes();

            return req;
        }

        /// <summary>
        /// Logs the request.
        /// </summary>
        /// <param name="logger">The logger.</param>
        /// <param name="request">The request.</param>
        private static void LogRequest(ILogger logger, HttpListenerRequest request)
        {
            var log = new StringBuilder();

            var headers = string.Join(",", request.Headers.AllKeys.Where(i => !string.Equals(i, "cookie", StringComparison.OrdinalIgnoreCase) && !string.Equals(i, "Referer", StringComparison.OrdinalIgnoreCase)).Select(k => k + "=" + request.Headers[k]));

            log.AppendLine("Ip: " + request.RemoteEndPoint + ". Headers: " + headers);

            var type = request.IsWebSocketRequest ? "Web Socket" : "HTTP " + request.HttpMethod;

            logger.LogMultiline(type + " " + request.Url, LogSeverity.Debug, log);
        }

        private void HandleError(Exception ex, HttpListenerContext context)
        {
            var httpReq = GetRequest(context);

            if (ErrorHandler != null)
            {
                ErrorHandler(ex, httpReq);
            }
        }

        public void Stop()
        {
            if (_listener != null)
            {
                foreach (var prefix in _listener.Prefixes.ToList())
                {
                    _listener.Prefixes.Remove(prefix);
                }

                _listener.Close();
            }
        }

        public void Dispose()
        {
            Dispose(true);
        }

        private bool _disposed;
        private readonly object _disposeLock = new object();
        protected virtual void Dispose(bool disposing)
        {
            if (_disposed) return;

            lock (_disposeLock)
            {
                if (_disposed) return;

                if (disposing)
                {
                    Stop();
                }

                //release unmanaged resources here...
                _disposed = true;
            }
        }
    }
}
