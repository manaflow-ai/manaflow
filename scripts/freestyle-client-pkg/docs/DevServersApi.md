# freestyle_client.DevServersApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_dev_server_logs**](DevServersApi.md#handle_dev_server_logs) | **POST** /ephemeral/v1/dev-servers/logs | Get logs from the dev server (journalctl -u freestyle-run-dev)
[**handle_dev_server_request**](DevServersApi.md#handle_dev_server_request) | **POST** /dev-servers/v1/dev-servers/request | Request a Dev Server
[**handle_dev_server_restart**](DevServersApi.md#handle_dev_server_restart) | **POST** /ephemeral/v1/dev-servers/restart | Restart the dev server (systemctl restart freestyle-run-dev)
[**handle_dev_server_status**](DevServersApi.md#handle_dev_server_status) | **GET** /ephemeral/v1/dev-servers/status | Get the status of a Dev Server
[**handle_ephemeral_dev_server**](DevServersApi.md#handle_ephemeral_dev_server) | **POST** /ephemeral/v1/dev-servers | Request a Dev Server
[**handle_exec_on_ephemeral_dev_server**](DevServersApi.md#handle_exec_on_ephemeral_dev_server) | **POST** /ephemeral/v1/dev-servers/exec | Execute a command on a Dev Server
[**handle_git_commit_push**](DevServersApi.md#handle_git_commit_push) | **POST** /ephemeral/v1/dev-servers/git/commit-push | Commit and push changes from the dev server
[**handle_shutdown_dev_server**](DevServersApi.md#handle_shutdown_dev_server) | **POST** /ephemeral/v1/dev-servers/shutdown | Shutdown a dev server
[**handle_watch_dev_server_files**](DevServersApi.md#handle_watch_dev_server_files) | **POST** /ephemeral/v1/dev-servers/watch-files | 


# **handle_dev_server_logs**
> HandleDevServerLogs200Response handle_dev_server_logs(dev_server_logs_request)

Get logs from the dev server (journalctl -u freestyle-run-dev)

### Example


```python
import freestyle_client
from freestyle_client.models.dev_server_logs_request import DevServerLogsRequest
from freestyle_client.models.handle_dev_server_logs200_response import HandleDevServerLogs200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    dev_server_logs_request = freestyle_client.DevServerLogsRequest() # DevServerLogsRequest | 

    try:
        # Get logs from the dev server (journalctl -u freestyle-run-dev)
        api_response = api_instance.handle_dev_server_logs(dev_server_logs_request)
        print("The response of DevServersApi->handle_dev_server_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_dev_server_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **dev_server_logs_request** | [**DevServerLogsRequest**](DevServerLogsRequest.md)|  | 

### Return type

[**HandleDevServerLogs200Response**](HandleDevServerLogs200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Successful |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_dev_server_request**
> handle_dev_server_request(dev_server_request_v2)

Request a Dev Server

### Example


```python
import freestyle_client
from freestyle_client.models.dev_server_request_v2 import DevServerRequestV2
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    dev_server_request_v2 = freestyle_client.DevServerRequestV2() # DevServerRequestV2 | 

    try:
        # Request a Dev Server
        api_instance.handle_dev_server_request(dev_server_request_v2)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_dev_server_request: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **dev_server_request_v2** | [**DevServerRequestV2**](DevServerRequestV2.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined


[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_dev_server_restart**
> HandleDevServerRestart200Response handle_dev_server_restart(dev_server_restart_request)

Restart the dev server (systemctl restart freestyle-run-dev)

### Example


```python
import freestyle_client
from freestyle_client.models.dev_server_restart_request import DevServerRestartRequest
from freestyle_client.models.handle_dev_server_restart200_response import HandleDevServerRestart200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    dev_server_restart_request = freestyle_client.DevServerRestartRequest() # DevServerRestartRequest | 

    try:
        # Restart the dev server (systemctl restart freestyle-run-dev)
        api_response = api_instance.handle_dev_server_restart(dev_server_restart_request)
        print("The response of DevServersApi->handle_dev_server_restart:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_dev_server_restart: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **dev_server_restart_request** | [**DevServerRestartRequest**](DevServerRestartRequest.md)|  | 

### Return type

[**HandleDevServerRestart200Response**](HandleDevServerRestart200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Successful |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_dev_server_status**
> HandleDevServerStatus200Response handle_dev_server_status(dev_server_status_request)

Get the status of a Dev Server

### Example


```python
import freestyle_client
from freestyle_client.models.dev_server_status_request import DevServerStatusRequest
from freestyle_client.models.handle_dev_server_status200_response import HandleDevServerStatus200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    dev_server_status_request = freestyle_client.DevServerStatusRequest() # DevServerStatusRequest | 

    try:
        # Get the status of a Dev Server
        api_response = api_instance.handle_dev_server_status(dev_server_status_request)
        print("The response of DevServersApi->handle_dev_server_status:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_dev_server_status: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **dev_server_status_request** | [**DevServerStatusRequest**](DevServerStatusRequest.md)|  | 

### Return type

[**HandleDevServerStatus200Response**](HandleDevServerStatus200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Successful |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_ephemeral_dev_server**
> HandleEphemeralDevServer200Response handle_ephemeral_dev_server(dev_server_request)

Request a Dev Server

### Example


```python
import freestyle_client
from freestyle_client.models.dev_server_request import DevServerRequest
from freestyle_client.models.handle_ephemeral_dev_server200_response import HandleEphemeralDevServer200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    dev_server_request = freestyle_client.DevServerRequest() # DevServerRequest | 

    try:
        # Request a Dev Server
        api_response = api_instance.handle_ephemeral_dev_server(dev_server_request)
        print("The response of DevServersApi->handle_ephemeral_dev_server:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_ephemeral_dev_server: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **dev_server_request** | [**DevServerRequest**](DevServerRequest.md)|  | 

### Return type

[**HandleEphemeralDevServer200Response**](HandleEphemeralDevServer200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Successful |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_exec_on_ephemeral_dev_server**
> HandleExecOnEphemeralDevServer200Response handle_exec_on_ephemeral_dev_server(exec_request)

Execute a command on a Dev Server

### Example


```python
import freestyle_client
from freestyle_client.models.exec_request import ExecRequest
from freestyle_client.models.handle_exec_on_ephemeral_dev_server200_response import HandleExecOnEphemeralDevServer200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    exec_request = freestyle_client.ExecRequest() # ExecRequest | 

    try:
        # Execute a command on a Dev Server
        api_response = api_instance.handle_exec_on_ephemeral_dev_server(exec_request)
        print("The response of DevServersApi->handle_exec_on_ephemeral_dev_server:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_exec_on_ephemeral_dev_server: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **exec_request** | [**ExecRequest**](ExecRequest.md)|  | 

### Return type

[**HandleExecOnEphemeralDevServer200Response**](HandleExecOnEphemeralDevServer200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Successful |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_git_commit_push**
> GitCommitPushResponse handle_git_commit_push(git_commit_push_request)

Commit and push changes from the dev server

### Example


```python
import freestyle_client
from freestyle_client.models.git_commit_push_request import GitCommitPushRequest
from freestyle_client.models.git_commit_push_response import GitCommitPushResponse
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    git_commit_push_request = freestyle_client.GitCommitPushRequest() # GitCommitPushRequest | 

    try:
        # Commit and push changes from the dev server
        api_response = api_instance.handle_git_commit_push(git_commit_push_request)
        print("The response of DevServersApi->handle_git_commit_push:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_git_commit_push: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **git_commit_push_request** | [**GitCommitPushRequest**](GitCommitPushRequest.md)|  | 

### Return type

[**GitCommitPushResponse**](GitCommitPushResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**400** | Error: DevServerInvalidRequest |  -  |
**404** | Possible errors: DevServerNotFound, DevServerFileNotFound |  -  |
**500** | Possible errors: RequestFailed, ExecutionFailed, ReadFileFailed, WriteFileFailed, CommitFailed, ShutdownFailed, RestartFailed, StatusFailed, LogsFailed, InternalError, WatchFilesFailed, BrowserOperationFailed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_shutdown_dev_server**
> HandleShutdownDevServer200Response handle_shutdown_dev_server(shutdown_dev_server_request)

Shutdown a dev server

### Example


```python
import freestyle_client
from freestyle_client.models.handle_shutdown_dev_server200_response import HandleShutdownDevServer200Response
from freestyle_client.models.shutdown_dev_server_request import ShutdownDevServerRequest
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    shutdown_dev_server_request = freestyle_client.ShutdownDevServerRequest() # ShutdownDevServerRequest | 

    try:
        # Shutdown a dev server
        api_response = api_instance.handle_shutdown_dev_server(shutdown_dev_server_request)
        print("The response of DevServersApi->handle_shutdown_dev_server:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_shutdown_dev_server: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **shutdown_dev_server_request** | [**ShutdownDevServerRequest**](ShutdownDevServerRequest.md)|  | 

### Return type

[**HandleShutdownDevServer200Response**](HandleShutdownDevServer200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Successful |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_watch_dev_server_files**
> str handle_watch_dev_server_files(dev_server_watch_files_request)

### Example


```python
import freestyle_client
from freestyle_client.models.dev_server_watch_files_request import DevServerWatchFilesRequest
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DevServersApi(api_client)
    dev_server_watch_files_request = freestyle_client.DevServerWatchFilesRequest() # DevServerWatchFilesRequest | 

    try:
        api_response = api_instance.handle_watch_dev_server_files(dev_server_watch_files_request)
        print("The response of DevServersApi->handle_watch_dev_server_files:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DevServersApi->handle_watch_dev_server_files: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **dev_server_watch_files_request** | [**DevServerWatchFilesRequest**](DevServerWatchFilesRequest.md)|  | 

### Return type

**str**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: text/plain

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Stream of file events |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

