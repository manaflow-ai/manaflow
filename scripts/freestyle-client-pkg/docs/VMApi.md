# freestyle_client.VMApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**create_snapshot**](VMApi.md#create_snapshot) | **POST** /v1/vms/snapshots | 
[**create_vm**](VMApi.md#create_vm) | **POST** /v1/vms | 
[**delete_vm**](VMApi.md#delete_vm) | **DELETE** /v1/vms/{vm_id} | 
[**exec_await**](VMApi.md#exec_await) | **POST** /v1/vms/{vm_id}/exec-await | 
[**fork_vm**](VMApi.md#fork_vm) | **POST** /v1/vms/{vm_id}/fork | 
[**get_file**](VMApi.md#get_file) | **GET** /v1/vms/{vm_id}/files/{filepath} | 
[**get_terminal_logs**](VMApi.md#get_terminal_logs) | **GET** /v1/vms/{vm_id}/terminals/{terminal_id}/logs | 
[**get_terminal_xterm**](VMApi.md#get_terminal_xterm) | **GET** /v1/vms/{vm_id}/terminals/{terminal_id}/xterm-256color | 
[**get_vm**](VMApi.md#get_vm) | **GET** /v1/vms/{vm_id} | 
[**kill_vm**](VMApi.md#kill_vm) | **POST** /v1/vms/{vm_id}/kill | 
[**list_snapshots**](VMApi.md#list_snapshots) | **GET** /v1/vms/snapshots | 
[**list_terminals**](VMApi.md#list_terminals) | **GET** /v1/vms/{vm_id}/terminals | 
[**list_vms**](VMApi.md#list_vms) | **GET** /v1/vms | 
[**optimize_vm**](VMApi.md#optimize_vm) | **POST** /v1/vms/{vm_id}/optimize | 
[**put_file**](VMApi.md#put_file) | **PUT** /v1/vms/{vm_id}/files/{filepath} | 
[**resize_vm**](VMApi.md#resize_vm) | **POST** /v1/vms/{id}/resize | 
[**snapshot_vm**](VMApi.md#snapshot_vm) | **POST** /v1/vms/{vm_id}/snapshot | 
[**start_vm**](VMApi.md#start_vm) | **POST** /v1/vms/{vm_id}/start | 
[**stop_vm**](VMApi.md#stop_vm) | **POST** /v1/vms/{vm_id}/stop | 
[**suspend_vm**](VMApi.md#suspend_vm) | **POST** /v1/vms/{vm_id}/suspend | 
[**wait_vm**](VMApi.md#wait_vm) | **POST** /v1/vms/{vm_id}/await | 
[**watch_files**](VMApi.md#watch_files) | **POST** /v1/vms/{vm_id}/watch-files | 


# **create_snapshot**
> CreateSnapshotResponse create_snapshot(create_snapshot_request)

Create a snapshot by creating a temporary VM, starting it, snapshotting it, then deleting the VM.

### Example


```python
import freestyle_client
from freestyle_client.models.create_snapshot_request import CreateSnapshotRequest
from freestyle_client.models.create_snapshot_response import CreateSnapshotResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    create_snapshot_request = freestyle_client.CreateSnapshotRequest() # CreateSnapshotRequest | 

    try:
        api_response = api_instance.create_snapshot(create_snapshot_request)
        print("The response of VMApi->create_snapshot:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->create_snapshot: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_snapshot_request** | [**CreateSnapshotRequest**](CreateSnapshotRequest.md)|  | 

### Return type

[**CreateSnapshotResponse**](CreateSnapshotResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Created snapshot |  -  |
**400** | Error: CreateSnapshotBadRequest |  -  |
**404** | Error: ForkVmNotFound |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **create_vm**
> CreateVmResponse create_vm(create_vm_request)

Create VM

### Example


```python
import freestyle_client
from freestyle_client.models.create_vm_request import CreateVmRequest
from freestyle_client.models.create_vm_response import CreateVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    create_vm_request = freestyle_client.CreateVmRequest() # CreateVmRequest | 

    try:
        api_response = api_instance.create_vm(create_vm_request)
        print("The response of VMApi->create_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->create_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_vm_request** | [**CreateVmRequest**](CreateVmRequest.md)|  | 

### Return type

[**CreateVmResponse**](CreateVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**400** | Error: CreateVmBadRequest |  -  |
**404** | Error: ForkVmNotFound |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_vm**
> DeleteVmResponses delete_vm(vm_id)

Delete VM

### Example


```python
import freestyle_client
from freestyle_client.models.delete_vm_responses import DeleteVmResponses
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to delete

    try:
        api_response = api_instance.delete_vm(vm_id)
        print("The response of VMApi->delete_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->delete_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to delete | 

### Return type

[**DeleteVmResponses**](DeleteVmResponses.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **exec_await**
> ExecAwaitVmResponse exec_await(vm_id, exec_await_request)

Execute command in VM and await result

### Example


```python
import freestyle_client
from freestyle_client.models.exec_await_request import ExecAwaitRequest
from freestyle_client.models.exec_await_vm_response import ExecAwaitVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to execute the command in
    exec_await_request = freestyle_client.ExecAwaitRequest() # ExecAwaitRequest | 

    try:
        api_response = api_instance.exec_await(vm_id, exec_await_request)
        print("The response of VMApi->exec_await:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->exec_await: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to execute the command in | 
 **exec_await_request** | [**ExecAwaitRequest**](ExecAwaitRequest.md)|  | 

### Return type

[**ExecAwaitVmResponse**](ExecAwaitVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **fork_vm**
> ForkVmResponse fork_vm(vm_id, fork_vm_request)

Fork VM

### Example


```python
import freestyle_client
from freestyle_client.models.fork_vm_request import ForkVmRequest
from freestyle_client.models.fork_vm_response import ForkVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | 
    fork_vm_request = freestyle_client.ForkVmRequest() # ForkVmRequest | 

    try:
        api_response = api_instance.fork_vm(vm_id, fork_vm_request)
        print("The response of VMApi->fork_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->fork_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**|  | 
 **fork_vm_request** | [**ForkVmRequest**](ForkVmRequest.md)|  | 

### Return type

[**ForkVmResponse**](ForkVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**400** | Error: CreateVmBadRequest |  -  |
**404** | Error: ForkVmNotFound |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_file**
> FileSystemResponse get_file(vm_id, filepath)

Get file from VM

### Example


```python
import freestyle_client
from freestyle_client.models.file_system_response import FileSystemResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to get the file from
    filepath = 'filepath_example' # str | The path of the file to get

    try:
        api_response = api_instance.get_file(vm_id, filepath)
        print("The response of VMApi->get_file:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->get_file: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to get the file from | 
 **filepath** | **str**| The path of the file to get | 

### Return type

[**FileSystemResponse**](FileSystemResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**400** | Error: FilesBadRequest |  -  |
**404** | Error: FileNotFound |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_terminal_logs**
> TerminalLogsArrayResponse get_terminal_logs(vm_id, terminal_id)

Get terminal logs as plain text array

### Example


```python
import freestyle_client
from freestyle_client.models.terminal_logs_array_response import TerminalLogsArrayResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM
    terminal_id = 'terminal_id_example' # str | The ID of the terminal session

    try:
        api_response = api_instance.get_terminal_logs(vm_id, terminal_id)
        print("The response of VMApi->get_terminal_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->get_terminal_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM | 
 **terminal_id** | **str**| The ID of the terminal session | 

### Return type

[**TerminalLogsArrayResponse**](TerminalLogsArrayResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_terminal_xterm**
> TerminalLogsResponse get_terminal_xterm(vm_id, terminal_id)

Get terminal output with xterm formatting

### Example


```python
import freestyle_client
from freestyle_client.models.terminal_logs_response import TerminalLogsResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM
    terminal_id = 'terminal_id_example' # str | The ID of the terminal session

    try:
        api_response = api_instance.get_terminal_xterm(vm_id, terminal_id)
        print("The response of VMApi->get_terminal_xterm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->get_terminal_xterm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM | 
 **terminal_id** | **str**| The ID of the terminal session | 

### Return type

[**TerminalLogsResponse**](TerminalLogsResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_vm**
> GetVmResponse get_vm(vm_id)

Get VM

### Example


```python
import freestyle_client
from freestyle_client.models.get_vm_response import GetVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | 

    try:
        api_response = api_instance.get_vm(vm_id)
        print("The response of VMApi->get_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->get_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**|  | 

### Return type

[**GetVmResponse**](GetVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **kill_vm**
> KillVmResponse kill_vm(vm_id)

Kill VM

### Example


```python
import freestyle_client
from freestyle_client.models.kill_vm_response import KillVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to kill

    try:
        api_response = api_instance.kill_vm(vm_id)
        print("The response of VMApi->kill_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->kill_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to kill | 

### Return type

[**KillVmResponse**](KillVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_snapshots**
> ListSnapshotsResponse list_snapshots()

List all snapshots.

### Example


```python
import freestyle_client
from freestyle_client.models.list_snapshots_response import ListSnapshotsResponse
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
    api_instance = freestyle_client.VMApi(api_client)

    try:
        api_response = api_instance.list_snapshots()
        print("The response of VMApi->list_snapshots:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->list_snapshots: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**ListSnapshotsResponse**](ListSnapshotsResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of snapshots |  -  |
**400** | Error: SnapshotVmBadRequest |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_terminals**
> TerminalListResponse list_terminals(vm_id)

List all terminal sessions for a VM

### Example


```python
import freestyle_client
from freestyle_client.models.terminal_list_response import TerminalListResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM

    try:
        api_response = api_instance.list_terminals(vm_id)
        print("The response of VMApi->list_terminals:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->list_terminals: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM | 

### Return type

[**TerminalListResponse**](TerminalListResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_vms**
> ListVmsResponse list_vms()

List VMs

### Example


```python
import freestyle_client
from freestyle_client.models.list_vms_response import ListVmsResponse
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
    api_instance = freestyle_client.VMApi(api_client)

    try:
        api_response = api_instance.list_vms()
        print("The response of VMApi->list_vms:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->list_vms: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**ListVmsResponse**](ListVmsResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **optimize_vm**
> OptimizeVmResponse optimize_vm(vm_id)

Suspends a VM and reallocates storage for more efficient forking.

### Example


```python
import freestyle_client
from freestyle_client.models.optimize_vm_response import OptimizeVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to optimize

    try:
        api_response = api_instance.optimize_vm(vm_id)
        print("The response of VMApi->optimize_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->optimize_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to optimize | 

### Return type

[**OptimizeVmResponse**](OptimizeVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **put_file**
> object put_file(vm_id, filepath, write_file_request)

Put file to VM

### Example


```python
import freestyle_client
from freestyle_client.models.write_file_request import WriteFileRequest
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to put the file to
    filepath = 'filepath_example' # str | The path of the file to put
    write_file_request = freestyle_client.WriteFileRequest() # WriteFileRequest | 

    try:
        api_response = api_instance.put_file(vm_id, filepath, write_file_request)
        print("The response of VMApi->put_file:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->put_file: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to put the file to | 
 **filepath** | **str**| The path of the file to put | 
 **write_file_request** | [**WriteFileRequest**](WriteFileRequest.md)|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**400** | Error: FilesBadRequest |  -  |
**404** | Error: FileNotFound |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **resize_vm**
> ResizeVmResponse resize_vm(id, resize_vm_request)

Resize VM

### Example


```python
import freestyle_client
from freestyle_client.models.resize_vm_request import ResizeVmRequest
from freestyle_client.models.resize_vm_response import ResizeVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    id = 'id_example' # str | 
    resize_vm_request = freestyle_client.ResizeVmRequest() # ResizeVmRequest | 

    try:
        api_response = api_instance.resize_vm(id, resize_vm_request)
        print("The response of VMApi->resize_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->resize_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 
 **resize_vm_request** | [**ResizeVmRequest**](ResizeVmRequest.md)|  | 

### Return type

[**ResizeVmResponse**](ResizeVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**400** | Error: InvalidParameters |  -  |
**404** | Error: InternalResizeVmNotFound |  -  |
**500** | Error: ResizeFailed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **snapshot_vm**
> SnapshotVmResponse snapshot_vm(vm_id, snapshot_vm_request)

Create a snapshot of a VM. The snapshot is stored in a special snapshots folder and cannot be booted directly, but can be used to create new VMs.

### Example


```python
import freestyle_client
from freestyle_client.models.snapshot_vm_request import SnapshotVmRequest
from freestyle_client.models.snapshot_vm_response import SnapshotVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | 
    snapshot_vm_request = freestyle_client.SnapshotVmRequest() # SnapshotVmRequest | 

    try:
        api_response = api_instance.snapshot_vm(vm_id, snapshot_vm_request)
        print("The response of VMApi->snapshot_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->snapshot_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**|  | 
 **snapshot_vm_request** | [**SnapshotVmRequest**](SnapshotVmRequest.md)|  | 

### Return type

[**SnapshotVmResponse**](SnapshotVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Created snapshot |  -  |
**400** | Error: SnapshotVmBadRequest |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **start_vm**
> StartedVmResponse start_vm(vm_id, start_vm_request)

Start VM

### Example


```python
import freestyle_client
from freestyle_client.models.start_vm_request import StartVmRequest
from freestyle_client.models.started_vm_response import StartedVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | 
    start_vm_request = freestyle_client.StartVmRequest() # StartVmRequest | 

    try:
        api_response = api_instance.start_vm(vm_id, start_vm_request)
        print("The response of VMApi->start_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->start_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**|  | 
 **start_vm_request** | [**StartVmRequest**](StartVmRequest.md)|  | 

### Return type

[**StartedVmResponse**](StartedVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**410** | Error: VmDeleted |  -  |
**500** | Possible errors: VmSubnetNotFound, VmCreateTmuxSession, StdIo, VmExitDuringStart, FirecrackerApiSocketNotFound, FirecrackerPidNotFound, Reqwest |  -  |
**504** | Error: VmStartTimeout |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **stop_vm**
> StopVmResponse stop_vm(vm_id)

Stop VM

### Example


```python
import freestyle_client
from freestyle_client.models.stop_vm_response import StopVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to stop

    try:
        api_response = api_instance.stop_vm(vm_id)
        print("The response of VMApi->stop_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->stop_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to stop | 

### Return type

[**StopVmResponse**](StopVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **suspend_vm**
> SuspendVmResponse suspend_vm(vm_id)

Suspend VM

### Example


```python
import freestyle_client
from freestyle_client.models.suspend_vm_response import SuspendVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to suspend

    try:
        api_response = api_instance.suspend_vm(vm_id)
        print("The response of VMApi->suspend_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->suspend_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to suspend | 

### Return type

[**SuspendVmResponse**](SuspendVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **wait_vm**
> WaitVmResponse wait_vm(vm_id)

Wait for VM to stop

### Example


```python
import freestyle_client
from freestyle_client.models.wait_vm_response import WaitVmResponse
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to wait for

    try:
        api_response = api_instance.wait_vm(vm_id)
        print("The response of VMApi->wait_vm:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling VMApi->wait_vm: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to wait for | 

### Return type

[**WaitVmResponse**](WaitVmResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** | Error: InternalError |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **watch_files**
> watch_files(vm_id)

Watch VM Files

### Example


```python
import freestyle_client
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
    api_instance = freestyle_client.VMApi(api_client)
    vm_id = 'vm_id_example' # str | The ID of the VM to watch files for

    try:
        api_instance.watch_files(vm_id)
    except Exception as e:
        print("Exception when calling VMApi->watch_files: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **vm_id** | **str**| The ID of the VM to watch files for | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined


[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

